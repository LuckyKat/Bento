/*!
 *  howler.js v1.1.21
 *  howlerjs.com
 *
 *  (c) 2013-2014, James Simpson of GoldFire Studios
 *  goldfirestudios.com
 *
 *  MIT License
 */

(function() {
  // setup
  var cache = {};

  // setup the audio context
  var ctx = null,
    usingWebAudio = true,
    noAudio = false;
  try {
    if (typeof AudioContext !== 'undefined') {
      ctx = new AudioContext();
    } else if (typeof webkitAudioContext !== 'undefined') {
      ctx = new webkitAudioContext();
    } else {
      usingWebAudio = false;
    }
  } catch(e) {
    usingWebAudio = false;
  }

  if (!usingWebAudio) {
    if (typeof Audio !== 'undefined') {
      try {
        new Audio();
      } catch(e) {
        noAudio = true;
      }
    } else {
      noAudio = true;
    }
  }

  // create a master gain node
  if (usingWebAudio) {
    var masterGain = (typeof ctx.createGain === 'undefined') ? ctx.createGainNode() : ctx.createGain();
    masterGain.gain.value = 1;
    masterGain.connect(ctx.destination);
  }

  // create global controller
  var HowlerGlobal = function() {
    this._volume = 1;
    this._muted = false;
    this.usingWebAudio = usingWebAudio;
    this.noAudio = noAudio;
    this._howls = [];
  };
  HowlerGlobal.prototype = {
    /**
     * Get/set the global volume for all sounds.
     * @param  {Float} vol Volume from 0.0 to 1.0.
     * @return {Howler/Float}     Returns self or current volume.
     */
    volume: function(vol) {
      var self = this;

      // make sure volume is a number
      vol = parseFloat(vol);

      if (vol >= 0 && vol <= 1) {
        self._volume = vol;

        if (usingWebAudio) {
          masterGain.gain.value = vol;
        }

        // loop through cache and change volume of all nodes that are using HTML5 Audio
        for (var key in self._howls) {
          if (self._howls.hasOwnProperty(key) && self._howls[key]._webAudio === false) {
            // loop through the audio nodes
            for (var i=0; i<self._howls[key]._audioNode.length; i++) {
              self._howls[key]._audioNode[i].volume = self._howls[key]._volume * self._volume;
            }
          }
        }

        return self;
      }

      // return the current global volume
      return (usingWebAudio) ? masterGain.gain.value : self._volume;
    },

    /**
     * Mute all sounds.
     * @return {Howler}
     */
    mute: function() {
      this._setMuted(true);

      return this;
    },

    /**
     * Unmute all sounds.
     * @return {Howler}
     */
    unmute: function() {
      this._setMuted(false);

      return this;
    },

    /**
     * Handle muting and unmuting globally.
     * @param  {Boolean} muted Is muted or not.
     */
    _setMuted: function(muted) {
      var self = this;

      self._muted = muted;

      if (usingWebAudio) {
        masterGain.gain.value = muted ? 0 : self._volume;
      }

      for (var key in self._howls) {
        if (self._howls.hasOwnProperty(key) && self._howls[key]._webAudio === false) {
          // loop through the audio nodes
          for (var i=0; i<self._howls[key]._audioNode.length; i++) {
            self._howls[key]._audioNode[i].muted = muted;
          }
        }
      }
    }
  };

  // allow access to the global audio controls
  var Howler = new HowlerGlobal();

  // check for browser codec support
  var audioTest = null;
  if (!noAudio) {
    audioTest = new Audio();
    var codecs = {
      mp3: !!audioTest.canPlayType('audio/mpeg;').replace(/^no$/, ''),
      opus: !!audioTest.canPlayType('audio/ogg; codecs="opus"').replace(/^no$/, ''),
      ogg: !!audioTest.canPlayType('audio/ogg; codecs="vorbis"').replace(/^no$/, ''),
      wav: !!audioTest.canPlayType('audio/wav; codecs="1"').replace(/^no$/, ''),
      aac: !!audioTest.canPlayType('audio/aac;').replace(/^no$/, ''),
      m4a: !!(audioTest.canPlayType('audio/x-m4a;') || audioTest.canPlayType('audio/m4a;') || audioTest.canPlayType('audio/aac;')).replace(/^no$/, ''),
      mp4: !!(audioTest.canPlayType('audio/x-mp4;') || audioTest.canPlayType('audio/mp4;') || audioTest.canPlayType('audio/aac;')).replace(/^no$/, ''),
      weba: !!audioTest.canPlayType('audio/webm; codecs="vorbis"').replace(/^no$/, '')
    };
  }

  // setup the audio object
  var Howl = function(o) {
    var self = this;

    // setup the defaults
    self._autoplay = o.autoplay || false;
    self._buffer = o.buffer || false;
    self._duration = o.duration || 0;
    self._format = o.format || null;
    self._loop = o.loop || false;
    self._loaded = false;
    self._sprite = o.sprite || {};
    self._src = o.src || '';
    self._pos3d = o.pos3d || [0, 0, -0.5];
    self._volume = o.volume !== undefined ? o.volume : 1;
    self._urls = o.urls || [];
    self._rate = o.rate || 1;

    // allow forcing of a specific panningModel ('equalpower' or 'HRTF'),
    // if none is specified, defaults to 'equalpower' and switches to 'HRTF'
    // if 3d sound is used
    self._model = o.model || null;

    // setup event functions
    self._onload = [o.onload || function() {}];
    self._onloaderror = [o.onloaderror || function() {}];
    self._onend = [o.onend || function() {}];
    self._onpause = [o.onpause || function() {}];
    self._onplay = [o.onplay || function() {}];

    self._onendTimer = [];

    // Web Audio or HTML5 Audio?
    self._webAudio = usingWebAudio && !self._buffer;

    // check if we need to fall back to HTML5 Audio
    self._audioNode = [];
    if (self._webAudio) {
      self._setupAudioNode();
    }

    // add this to an array of Howl's to allow global control
    Howler._howls.push(self);

    // load the track
    self.load();
  };

  // setup all of the methods
  Howl.prototype = {
    /**
     * Load an audio file.
     * @return {Howl}
     */
    load: function() {
      var self = this,
        url = null;

      // if no audio is available, quit immediately
      if (noAudio) {
        self.on('loaderror');
        return;
      }

      // loop through source URLs and pick the first one that is compatible
      for (var i=0; i<self._urls.length; i++) {
        var ext, urlItem;

        if (self._format) {
          // use specified audio format if available
          ext = self._format;
        } else {
          // figure out the filetype (whether an extension or base64 data)
          urlItem = self._urls[i].toLowerCase().split('?')[0];
          ext = urlItem.match(/.+\.([^?]+)(\?|$)/);
          ext = (ext && ext.length >= 2) ? ext : urlItem.match(/data\:audio\/([^?]+);/);

          if (ext) {
            ext = ext[1];
          } else {
            self.on('loaderror');
            return;
          }
        }

        if (codecs[ext]) {
          url = self._urls[i];
          break;
        }
      }

      if (!url) {
        self.on('loaderror');
        return;
      }

      self._src = url;

      if (self._webAudio) {
        loadBuffer(self, url);
      } else {
        var newNode = new Audio();

        // listen for errors with HTML5 audio (http://dev.w3.org/html5/spec-author-view/spec.html#mediaerror)
        newNode.addEventListener('error', function () {
          if (newNode.error && newNode.error.code === 4) {
            HowlerGlobal.noAudio = true;
          }

          self.on('loaderror', {type: newNode.error ? newNode.error.code : 0});
        }, false);

        self._audioNode.push(newNode);

        // setup the new audio node
        newNode.src = url;
        newNode._pos = 0;
        newNode.preload = 'auto';
        newNode.volume = (Howler._muted) ? 0 : self._volume * Howler.volume();

        // add this sound to the cache
        cache[url] = self;

        // setup the event listener to start playing the sound
        // as soon as it has buffered enough
        var listener = function() {
          // round up the duration when using HTML5 Audio to account for the lower precision
          self._duration = Math.ceil(newNode.duration * 10) / 10;

          // setup a sprite if none is defined
          if (Object.getOwnPropertyNames(self._sprite).length === 0) {
            self._sprite = {_default: [0, self._duration * 1000]};
          }

          if (!self._loaded) {
            self._loaded = true;
            self.on('load');
          }

          if (self._autoplay) {
            self.play();
          }

          // clear the event listener
          newNode.removeEventListener('canplaythrough', listener, false);
        };
        newNode.addEventListener('canplaythrough', listener, false);
        newNode.load();
      }

      return self;
    },

    /**
     * Get/set the URLs to be pulled from to play in this source.
     * @param  {Array} urls  Arry of URLs to load from
     * @return {Howl}        Returns self or the current URLs
     */
    urls: function(urls) {
      var self = this;

      if (urls) {
        self.stop();
        self._urls = (typeof urls === 'string') ? [urls] : urls;
        self._loaded = false;
        self.load();

        return self;
      } else {
        return self._urls;
      }
    },

    /**
     * Play a sound from the current time (0 by default).
     * @param  {String}   sprite   (optional) Plays from the specified position in the sound sprite definition.
     * @param  {Function} callback (optional) Returns the unique playback id for this sound instance.
     * @return {Howl}
     */
    play: function(sprite, callback) {
      var self = this;

      // if no sprite was passed but a callback was, update the variables
      if (typeof sprite === 'function') {
        callback = sprite;
      }

      // use the default sprite if none is passed
      if (!sprite || typeof sprite === 'function') {
        sprite = '_default';
      }

      // if the sound hasn't been loaded, add it to the event queue
      if (!self._loaded) {
        self.on('load', function() {
          self.play(sprite, callback);
        });

        return self;
      }

      // if the sprite doesn't exist, play nothing
      if (!self._sprite[sprite]) {
        if (typeof callback === 'function') callback();
        return self;
      }

      // get the node to playback
      self._inactiveNode(function(node) {
        // persist the sprite being played
        node._sprite = sprite;

        // determine where to start playing from
        var pos = (node._pos > 0) ? node._pos : self._sprite[sprite][0] / 1000;

        // determine how long to play for
        var duration = 0;
        if (self._webAudio) {
          duration = self._sprite[sprite][1] / 1000 - node._pos;
          if (node._pos > 0) {
            pos = self._sprite[sprite][0] / 1000 + pos;
          }
        } else {
          duration = self._sprite[sprite][1] / 1000 - (pos - self._sprite[sprite][0] / 1000);
        }

        // determine if this sound should be looped
        var loop = !!(self._loop || self._sprite[sprite][2]);

        // set timer to fire the 'onend' event
        var soundId = (typeof callback === 'string') ? callback : Math.round(Date.now() * Math.random()) + '',
          timerId;
        (function() {
          var data = {
            id: soundId,
            sprite: sprite,
            loop: loop
          };
          timerId = setTimeout(function() {
            // if looping, restart the track
            if (!self._webAudio && loop) {
              self.stop(data.id).play(sprite, data.id);
            }

            // set web audio node to paused at end
            if (self._webAudio && !loop) {
              self._nodeById(data.id).paused = true;
              self._nodeById(data.id)._pos = 0;
            }

            // end the track if it is HTML audio and a sprite
            if (!self._webAudio && !loop) {
              self.stop(data.id);
            }

            // fire ended event
            self.on('end', soundId);
          }, duration * 1000);

          // store the reference to the timer
          self._onendTimer.push({timer: timerId, id: data.id});
        })();

        if (self._webAudio) {
          var loopStart = self._sprite[sprite][0] / 1000,
            loopEnd = self._sprite[sprite][1] / 1000;

          // set the play id to this node and load into context
          node.id = soundId;
          node.paused = false;
          refreshBuffer(self, [loop, loopStart, loopEnd], soundId);
          self._playStart = ctx.currentTime;
          node.gain.value = self._volume;

          if (typeof node.bufferSource.start === 'undefined') {
            node.bufferSource.noteGrainOn(0, pos, duration);
          } else {
            node.bufferSource.start(0, pos, duration);
          }
        } else {
          if (node.readyState === 4 || !node.readyState && navigator.isCocoonJS) {
            node.readyState = 4;
            node.id = soundId;
            node.currentTime = pos;
            node.muted = Howler._muted || node.muted;
            node.volume = self._volume * Howler.volume();
            setTimeout(function() { node.play(); }, 0);
          } else {
            self._clearEndTimer(soundId);

            (function(){
              var sound = self,
                playSprite = sprite,
                fn = callback,
                newNode = node;
              var listener = function() {
                sound.play(playSprite, fn);

                // clear the event listener
                newNode.removeEventListener('canplaythrough', listener, false);
              };
              newNode.addEventListener('canplaythrough', listener, false);
            })();

            return self;
          }
        }

        // fire the play event and send the soundId back in the callback
        self.on('play');
        if (typeof callback === 'function') callback(soundId);

        return self;
      });

      return self;
    },

    /**
     * Pause playback and save the current position.
     * @param {String} id (optional) The play instance ID.
     * @return {Howl}
     */
    pause: function(id) {
      var self = this;

      // if the sound hasn't been loaded, add it to the event queue
      if (!self._loaded) {
        self.on('play', function() {
          self.pause(id);
        });

        return self;
      }

      // clear 'onend' timer
      self._clearEndTimer(id);

      var activeNode = (id) ? self._nodeById(id) : self._activeNode();
      if (activeNode) {
        activeNode._pos = self.pos(null, id);

        if (self._webAudio) {
          // make sure the sound has been created
          if (!activeNode.bufferSource || activeNode.paused) {
            return self;
          }

          activeNode.paused = true;
          if (typeof activeNode.bufferSource.stop === 'undefined') {
            activeNode.bufferSource.noteOff(0);
          } else {
            activeNode.bufferSource.stop(0);
          }
        } else {
          activeNode.pause();
        }
      }

      self.on('pause');

      return self;
    },

    /**
     * Stop playback and reset to start.
     * @param  {String} id  (optional) The play instance ID.
     * @return {Howl}
     */
    stop: function(id) {
      var self = this;

      // if the sound hasn't been loaded, add it to the event queue
      if (!self._loaded) {
        self.on('play', function() {
          self.stop(id);
        });

        return self;
      }

      // clear 'onend' timer
      self._clearEndTimer(id);

      var activeNode = (id) ? self._nodeById(id) : self._activeNode();
      if (activeNode) {
        activeNode._pos = 0;

        if (self._webAudio) {
          // make sure the sound has been created
          if (!activeNode.bufferSource || activeNode.paused) {
            return self;
          }

          activeNode.paused = true;

          if (typeof activeNode.bufferSource.stop === 'undefined') {
            activeNode.bufferSource.noteOff(0);
          } else {
            activeNode.bufferSource.stop(0);
          }
        } else if (!isNaN(activeNode.duration)) {
          activeNode.pause();
          activeNode.currentTime = 0;
        }
      }

      return self;
    },

    /**
     * Mute this sound.
     * @param  {String} id (optional) The play instance ID.
     * @return {Howl}
     */
    mute: function(id) {
      var self = this;

      // if the sound hasn't been loaded, add it to the event queue
      if (!self._loaded) {
        self.on('play', function() {
          self.mute(id);
        });

        return self;
      }

      var activeNode = (id) ? self._nodeById(id) : self._activeNode();
      if (activeNode) {
        if (self._webAudio) {
          activeNode.gain.value = 0;
        } else {
          activeNode.muted = true;
        }
      }

      return self;
    },

    /**
     * Unmute this sound.
     * @param  {String} id (optional) The play instance ID.
     * @return {Howl}
     */
    unmute: function(id) {
      var self = this;

      // if the sound hasn't been loaded, add it to the event queue
      if (!self._loaded) {
        self.on('play', function() {
          self.unmute(id);
        });

        return self;
      }

      var activeNode = (id) ? self._nodeById(id) : self._activeNode();
      if (activeNode) {
        if (self._webAudio) {
          activeNode.gain.value = self._volume;
        } else {
          activeNode.muted = false;
        }
      }

      return self;
    },

    /**
     * Get/set volume of this sound.
     * @param  {Float}  vol Volume from 0.0 to 1.0.
     * @param  {String} id  (optional) The play instance ID.
     * @return {Howl/Float}     Returns self or current volume.
     */
    volume: function(vol, id) {
      var self = this;

      // make sure volume is a number
      vol = parseFloat(vol);

      if (vol >= 0 && vol <= 1) {
        self._volume = vol;

        // if the sound hasn't been loaded, add it to the event queue
        if (!self._loaded) {
          self.on('play', function() {
            self.volume(vol, id);
          });

          return self;
        }

        var activeNode = (id) ? self._nodeById(id) : self._activeNode();
        if (activeNode) {
          if (self._webAudio) {
            activeNode.gain.value = vol;
          } else {
            activeNode.volume = vol * Howler.volume();
          }
        }

        return self;
      } else {
        return self._volume;
      }
    },

    /**
     * Get/set whether to loop the sound.
     * @param  {Boolean} loop To loop or not to loop, that is the question.
     * @return {Howl/Boolean}      Returns self or current looping value.
     */
    loop: function(loop) {
      var self = this;

      if (typeof loop === 'boolean') {
        self._loop = loop;

        return self;
      } else {
        return self._loop;
      }
    },

    /**
     * Get/set sound sprite definition.
     * @param  {Object} sprite Example: {spriteName: [offset, duration, loop]}
     *                @param {Integer} offset   Where to begin playback in milliseconds
     *                @param {Integer} duration How long to play in milliseconds
     *                @param {Boolean} loop     (optional) Set true to loop this sprite
     * @return {Howl}        Returns current sprite sheet or self.
     */
    sprite: function(sprite) {
      var self = this;

      if (typeof sprite === 'object') {
        self._sprite = sprite;

        return self;
      } else {
        return self._sprite;
      }
    },

    /**
     * Get/set the position of playback.
     * @param  {Float}  pos The position to move current playback to.
     * @param  {String} id  (optional) The play instance ID.
     * @return {Howl/Float}      Returns self or current playback position.
     */
    pos: function(pos, id) {
      var self = this;

      // if the sound hasn't been loaded, add it to the event queue
      if (!self._loaded) {
        self.on('load', function() {
          self.pos(pos);
        });

        return typeof pos === 'number' ? self : self._pos || 0;
      }

      // make sure we are dealing with a number for pos
      pos = parseFloat(pos);

      var activeNode = (id) ? self._nodeById(id) : self._activeNode();
      if (activeNode) {
        if (pos >= 0) {
          self.pause(id);
          activeNode._pos = pos;
          self.play(activeNode._sprite, id);

          return self;
        } else {
          return self._webAudio ? activeNode._pos + (ctx.currentTime - self._playStart) : activeNode.currentTime;
        }
      } else if (pos >= 0) {
        return self;
      } else {
        // find the first inactive node to return the pos for
        for (var i=0; i<self._audioNode.length; i++) {
          if (self._audioNode[i].paused && self._audioNode[i].readyState === 4) {
            return (self._webAudio) ? self._audioNode[i]._pos : self._audioNode[i].currentTime;
          }
        }
      }
    },

    /**
     * Get/set the 3D position of the audio source.
     * The most common usage is to set the 'x' position
     * to affect the left/right ear panning. Setting any value higher than
     * 1.0 will begin to decrease the volume of the sound as it moves further away.
     * NOTE: This only works with Web Audio API, HTML5 Audio playback
     * will not be affected.
     * @param  {Float}  x  The x-position of the playback from -1000.0 to 1000.0
     * @param  {Float}  y  The y-position of the playback from -1000.0 to 1000.0
     * @param  {Float}  z  The z-position of the playback from -1000.0 to 1000.0
     * @param  {String} id (optional) The play instance ID.
     * @return {Howl/Array}   Returns self or the current 3D position: [x, y, z]
     */
    pos3d: function(x, y, z, id) {
      var self = this;

      // set a default for the optional 'y' & 'z'
      y = (typeof y === 'undefined' || !y) ? 0 : y;
      z = (typeof z === 'undefined' || !z) ? -0.5 : z;

      // if the sound hasn't been loaded, add it to the event queue
      if (!self._loaded) {
        self.on('play', function() {
          self.pos3d(x, y, z, id);
        });

        return self;
      }

      if (x >= 0 || x < 0) {
        if (self._webAudio) {
          var activeNode = (id) ? self._nodeById(id) : self._activeNode();
          if (activeNode) {
            self._pos3d = [x, y, z];
            activeNode.panner.setPosition(x, y, z);
            activeNode.panner.panningModel = self._model || 'HRTF';
          }
        }
      } else {
        return self._pos3d;
      }

      return self;
    },

    /**
     * Fade a currently playing sound between two volumes.
     * @param  {Number}   from     The volume to fade from (0.0 to 1.0).
     * @param  {Number}   to       The volume to fade to (0.0 to 1.0).
     * @param  {Number}   len      Time in milliseconds to fade.
     * @param  {Function} callback (optional) Fired when the fade is complete.
     * @param  {String}   id       (optional) The play instance ID.
     * @return {Howl}
     */
    fade: function(from, to, len, callback, id) {
      var self = this,
        diff = Math.abs(from - to),
        dir = from > to ? 'down' : 'up',
        steps = diff / 0.01,
        stepTime = len / steps;

      // if the sound hasn't been loaded, add it to the event queue
      if (!self._loaded) {
        self.on('load', function() {
          self.fade(from, to, len, callback, id);
        });

        return self;
      }

      // set the volume to the start position
      self.volume(from, id);

      for (var i=1; i<=steps; i++) {
        (function() {
          var change = self._volume + (dir === 'up' ? 0.01 : -0.01) * i,
            vol = Math.round(1000 * change) / 1000,
            toVol = to;

          setTimeout(function() {
            self.volume(vol, id);

            if (vol === toVol) {
              if (callback) callback();
            }
          }, stepTime * i);
        })();
      }
    },

    /**
     * [DEPRECATED] Fade in the current sound.
     * @param  {Float}    to      Volume to fade to (0.0 to 1.0).
     * @param  {Number}   len     Time in milliseconds to fade.
     * @param  {Function} callback
     * @return {Howl}
     */
    fadeIn: function(to, len, callback) {
      return this.volume(0).play().fade(0, to, len, callback);
    },

    /**
     * [DEPRECATED] Fade out the current sound and pause when finished.
     * @param  {Float}    to       Volume to fade to (0.0 to 1.0).
     * @param  {Number}   len      Time in milliseconds to fade.
     * @param  {Function} callback
     * @param  {String}   id       (optional) The play instance ID.
     * @return {Howl}
     */
    fadeOut: function(to, len, callback, id) {
      var self = this;

      return self.fade(self._volume, to, len, function() {
        if (callback) callback();
        self.pause(id);

        // fire ended event
        self.on('end');
      }, id);
    },

    /**
     * Get an audio node by ID.
     * @return {Howl} Audio node.
     */
    _nodeById: function(id) {
      var self = this,
        node = self._audioNode[0];

      // find the node with this ID
      for (var i=0; i<self._audioNode.length; i++) {
        if (self._audioNode[i].id === id) {
          node = self._audioNode[i];
          break;
        }
      }

      return node;
    },

    /**
     * Get the first active audio node.
     * @return {Howl} Audio node.
     */
    _activeNode: function() {
      var self = this,
        node = null;

      // find the first playing node
      for (var i=0; i<self._audioNode.length; i++) {
        if (!self._audioNode[i].paused) {
          node = self._audioNode[i];
          break;
        }
      }

      // remove excess inactive nodes
      self._drainPool();

      return node;
    },

    /**
     * Get the first inactive audio node.
     * If there is none, create a new one and add it to the pool.
     * @param  {Function} callback Function to call when the audio node is ready.
     */
    _inactiveNode: function(callback) {
      var self = this,
        node = null;

      // find first inactive node to recycle
      for (var i=0; i<self._audioNode.length; i++) {
        if (self._audioNode[i].paused && self._audioNode[i].readyState === 4) {
          // send the node back for use by the new play instance
          callback(self._audioNode[i]);
          node = true;
          break;
        }
      }

      // remove excess inactive nodes
      self._drainPool();

      if (node) {
        return;
      }

      // create new node if there are no inactives
      var newNode;
      if (self._webAudio) {
        newNode = self._setupAudioNode();
        callback(newNode);
      } else {
        self.load();
        newNode = self._audioNode[self._audioNode.length - 1];

        // listen for the correct load event and fire the callback
        var listenerEvent = navigator.isCocoonJS ? 'canplaythrough' : 'loadedmetadata';
        var listener = function() {
          newNode.removeEventListener(listenerEvent, listener, false);
          callback(newNode);
        };
        newNode.addEventListener(listenerEvent, listener, false);
      }
    },

    /**
     * If there are more than 5 inactive audio nodes in the pool, clear out the rest.
     */
    _drainPool: function() {
      var self = this,
        inactive = 0,
        i;

      // count the number of inactive nodes
      for (i=0; i<self._audioNode.length; i++) {
        if (self._audioNode[i].paused) {
          inactive++;
        }
      }

      // remove excess inactive nodes
      for (i=self._audioNode.length-1; i>=0; i--) {
        if (inactive <= 5) {
          break;
        }

        if (self._audioNode[i].paused) {
          // disconnect the audio source if using Web Audio
          if (self._webAudio) {
            self._audioNode[i].disconnect(0);
          }

          inactive--;
          self._audioNode.splice(i, 1);
        }
      }
    },

    /**
     * Clear 'onend' timeout before it ends.
     * @param  {String} soundId  The play instance ID.
     */
    _clearEndTimer: function(soundId) {
      var self = this,
        index = 0;

      // loop through the timers to find the one associated with this sound
      for (var i=0; i<self._onendTimer.length; i++) {
        if (self._onendTimer[i].id === soundId) {
          index = i;
          break;
        }
      }

      var timer = self._onendTimer[index];
      if (timer) {
        clearTimeout(timer.timer);
        self._onendTimer.splice(index, 1);
      }
    },

    /**
     * Setup the gain node and panner for a Web Audio instance.
     * @return {Object} The new audio node.
     */
    _setupAudioNode: function() {
      var self = this,
        node = self._audioNode,
        index = self._audioNode.length;

      // create gain node
      node[index] = (typeof ctx.createGain === 'undefined') ? ctx.createGainNode() : ctx.createGain();
      node[index].gain.value = self._volume;
      node[index].paused = true;
      node[index]._pos = 0;
      node[index].readyState = 4;
      node[index].connect(masterGain);

      // create the panner
      node[index].panner = ctx.createPanner();
      node[index].panner.panningModel = self._model || 'equalpower';
      node[index].panner.setPosition(self._pos3d[0], self._pos3d[1], self._pos3d[2]);
      node[index].panner.connect(node[index]);

      return node[index];
    },

    /**
     * Call/set custom events.
     * @param  {String}   event Event type.
     * @param  {Function} fn    Function to call.
     * @return {Howl}
     */
    on: function(event, fn) {
      var self = this,
        events = self['_on' + event];

      if (typeof fn === 'function') {
        events.push(fn);
      } else {
        for (var i=0; i<events.length; i++) {
          if (fn) {
            events[i].call(self, fn);
          } else {
            events[i].call(self);
          }
        }
      }

      return self;
    },

    /**
     * Remove a custom event.
     * @param  {String}   event Event type.
     * @param  {Function} fn    Listener to remove.
     * @return {Howl}
     */
    off: function(event, fn) {
      var self = this,
        events = self['_on' + event],
        fnString = fn.toString();

      // loop through functions in the event for comparison
      for (var i=0; i<events.length; i++) {
        if (fnString === events[i].toString()) {
          events.splice(i, 1);
          break;
        }
      }

      return self;
    },

    /**
     * Unload and destroy the current Howl object.
     * This will immediately stop all play instances attached to this sound.
     */
    unload: function() {
      var self = this;

      // stop playing any active nodes
      var nodes = self._audioNode;
      for (var i=0; i<self._audioNode.length; i++) {
        // stop the sound if it is currently playing
        if (!nodes[i].paused) {
          self.stop(nodes[i].id);
        }

        if (!self._webAudio) {
          // remove the source if using HTML5 Audio
          nodes[i].src = '';
        } else {
          // disconnect the output from the master gain
          nodes[i].disconnect(0);
        }
      }

      // make sure all timeouts are cleared
      for (i=0; i<self._onendTimer.length; i++) {
        clearTimeout(self._onendTimer[i].timer);
      }

      // remove the reference in the global Howler object
      var index = Howler._howls.indexOf(self);
      if (index !== null && index >= 0) {
        Howler._howls.splice(index, 1);
      }

      // delete this sound from the cache
      delete cache[self._src];
      self = null;
    }

  };

  // only define these functions when using WebAudio
  if (usingWebAudio) {

    /**
     * Buffer a sound from URL (or from cache) and decode to audio source (Web Audio API).
     * @param  {Object} obj The Howl object for the sound to load.
     * @param  {String} url The path to the sound file.
     */
    var loadBuffer = function(obj, url) {
      // check if the buffer has already been cached
      if (url in cache) {
        // set the duration from the cache
        obj._duration = cache[url].duration;

        // load the sound into this object
        loadSound(obj);
      } else {
        // load the buffer from the URL
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType = 'arraybuffer';
        xhr.onload = function() {
          // decode the buffer into an audio source
          ctx.decodeAudioData(
            xhr.response,
            function(buffer) {
              if (buffer) {
                cache[url] = buffer;
                loadSound(obj, buffer);
              }
            },
            function(err) {
              obj.on('loaderror');
            }
          );
        };
        xhr.onerror = function() {
          // if there is an error, switch the sound to HTML Audio
          if (obj._webAudio) {
            obj._buffer = true;
            obj._webAudio = false;
            obj._audioNode = [];
            delete obj._gainNode;
            obj.load();
          }
        };
        try {
          xhr.send();
        } catch (e) {
          xhr.onerror();
        }
      }
    };

    /**
     * Finishes loading the Web Audio API sound and fires the loaded event
     * @param  {Object}  obj    The Howl object for the sound to load.
     * @param  {Objecct} buffer The decoded buffer sound source.
     */
    var loadSound = function(obj, buffer) {
      // set the duration
      obj._duration = (buffer) ? buffer.duration : obj._duration;

      // setup a sprite if none is defined
      if (Object.getOwnPropertyNames(obj._sprite).length === 0) {
        obj._sprite = {_default: [0, obj._duration * 1000]};
      }

      // fire the loaded event
      if (!obj._loaded) {
        obj._loaded = true;
        obj.on('load');
      }

      if (obj._autoplay) {
        obj.play();
      }
    };

    /**
     * Load the sound back into the buffer source.
     * @param  {Object} obj   The sound to load.
     * @param  {Array}  loop  Loop boolean, pos, and duration.
     * @param  {String} id    (optional) The play instance ID.
     */
    var refreshBuffer = function(obj, loop, id) {
      // determine which node to connect to
      var node = obj._nodeById(id);

      // setup the buffer source for playback
      node.bufferSource = ctx.createBufferSource();
      node.bufferSource.buffer = cache[obj._src];
      node.bufferSource.connect(node.panner);
      node.bufferSource.loop = loop[0];
      if (loop[0]) {
        node.bufferSource.loopStart = loop[1];
        node.bufferSource.loopEnd = loop[1] + loop[2];
      }
      node.bufferSource.playbackRate.value = obj._rate;
    };

  }

  /**
   * Add support for AMD (Asynchronous Module Definition) libraries such as require.js.
   */
  if (typeof define === 'function' && define.amd) {
    define(function() {
      return {
        Howler: Howler,
        Howl: Howl
      };
    });
  }

  /**
   * Add support for CommonJS libraries such as browserify.
   */
  if (typeof exports !== 'undefined') {
    exports.Howler = Howler;
    exports.Howl = Howl;
  }

  // define globally in case AMD is not available or available but not used

  if (typeof window !== 'undefined') {
    window.Howler = Howler;
    window.Howl = Howl;
  }

})();

/** vim: et:ts=4:sw=4:sts=4
 * @license RequireJS 2.1.9 Copyright (c) 2010-2012, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/jrburke/requirejs for details
 */
//Not using strict: uneven strict support in browsers, #392, and causes
//problems with requirejs.exec()/transpiler plugins that may not be strict.
/*jslint regexp: true, nomen: true, sloppy: true */
/*global window, navigator, document, importScripts, setTimeout, opera */

var requirejs, require, define;
(function (global) {
    var req, s, head, baseElement, dataMain, src,
        interactiveScript, currentlyAddingScript, mainScript, subPath,
        version = '2.1.9',
        commentRegExp = /(\/\*([\s\S]*?)\*\/|([^:]|^)\/\/(.*)$)/mg,
        cjsRequireRegExp = /[^.]\s*require\s*\(\s*["']([^'"\s]+)["']\s*\)/g,
        jsSuffixRegExp = /\.js$/,
        currDirRegExp = /^\.\//,
        op = Object.prototype,
        ostring = op.toString,
        hasOwn = op.hasOwnProperty,
        ap = Array.prototype,
        apsp = ap.splice,
        isBrowser = !!(typeof window !== 'undefined' && typeof navigator !== 'undefined' && window.document),
        isWebWorker = !isBrowser && typeof importScripts !== 'undefined',
        //PS3 indicates loaded and complete, but need to wait for complete
        //specifically. Sequence is 'loading', 'loaded', execution,
        // then 'complete'. The UA check is unfortunate, but not sure how
        //to feature test w/o causing perf issues.
        readyRegExp = isBrowser && navigator.platform === 'PLAYSTATION 3' ?
                      /^complete$/ : /^(complete|loaded)$/,
        defContextName = '_',
        //Oh the tragedy, detecting opera. See the usage of isOpera for reason.
        isOpera = typeof opera !== 'undefined' && opera.toString() === '[object Opera]',
        contexts = {},
        cfg = {},
        globalDefQueue = [],
        useInteractive = false;

    function isFunction(it) {
        return ostring.call(it) === '[object Function]';
    }

    function isArray(it) {
        return ostring.call(it) === '[object Array]';
    }

    /**
     * Helper function for iterating over an array. If the func returns
     * a true value, it will break out of the loop.
     */
    function each(ary, func) {
        if (ary) {
            var i;
            for (i = 0; i < ary.length; i += 1) {
                if (ary[i] && func(ary[i], i, ary)) {
                    break;
                }
            }
        }
    }

    /**
     * Helper function for iterating over an array backwards. If the func
     * returns a true value, it will break out of the loop.
     */
    function eachReverse(ary, func) {
        if (ary) {
            var i;
            for (i = ary.length - 1; i > -1; i -= 1) {
                if (ary[i] && func(ary[i], i, ary)) {
                    break;
                }
            }
        }
    }

    function hasProp(obj, prop) {
        return hasOwn.call(obj, prop);
    }

    function getOwn(obj, prop) {
        return hasProp(obj, prop) && obj[prop];
    }

    /**
     * Cycles over properties in an object and calls a function for each
     * property value. If the function returns a truthy value, then the
     * iteration is stopped.
     */
    function eachProp(obj, func) {
        var prop;
        for (prop in obj) {
            if (hasProp(obj, prop)) {
                if (func(obj[prop], prop)) {
                    break;
                }
            }
        }
    }

    /**
     * Simple function to mix in properties from source into target,
     * but only if target does not already have a property of the same name.
     */
    function mixin(target, source, force, deepStringMixin) {
        if (source) {
            eachProp(source, function (value, prop) {
                if (force || !hasProp(target, prop)) {
                    if (deepStringMixin && typeof value !== 'string') {
                        if (!target[prop]) {
                            target[prop] = {};
                        }
                        mixin(target[prop], value, force, deepStringMixin);
                    } else {
                        target[prop] = value;
                    }
                }
            });
        }
        return target;
    }

    //Similar to Function.prototype.bind, but the 'this' object is specified
    //first, since it is easier to read/figure out what 'this' will be.
    function bind(obj, fn) {
        return function () {
            return fn.apply(obj, arguments);
        };
    }

    function scripts() {
        return document.getElementsByTagName('script');
    }

    function defaultOnError(err) {
        throw err;
    }

    //Allow getting a global that expressed in
    //dot notation, like 'a.b.c'.
    function getGlobal(value) {
        if (!value) {
            return value;
        }
        var g = global;
        each(value.split('.'), function (part) {
            g = g[part];
        });
        return g;
    }

    /**
     * Constructs an error with a pointer to an URL with more information.
     * @param {String} id the error ID that maps to an ID on a web page.
     * @param {String} message human readable error.
     * @param {Error} [err] the original error, if there is one.
     *
     * @returns {Error}
     */
    function makeError(id, msg, err, requireModules) {
        var e = new Error(msg + '\nhttp://requirejs.org/docs/errors.html#' + id);
        e.requireType = id;
        e.requireModules = requireModules;
        if (err) {
            e.originalError = err;
        }
        return e;
    }

    if (typeof define !== 'undefined') {
        //If a define is already in play via another AMD loader,
        //do not overwrite.
        return;
    }

    if (typeof requirejs !== 'undefined') {
        if (isFunction(requirejs)) {
            //Do not overwrite and existing requirejs instance.
            return;
        }
        cfg = requirejs;
        requirejs = undefined;
    }

    //Allow for a require config object
    if (typeof require !== 'undefined' && !isFunction(require)) {
        //assume it is a config object.
        cfg = require;
        require = undefined;
    }

    function newContext(contextName) {
        var inCheckLoaded, Module, context, handlers,
            checkLoadedTimeoutId,
            config = {
                //Defaults. Do not set a default for map
                //config to speed up normalize(), which
                //will run faster if there is no default.
                waitSeconds: 7,
                baseUrl: './',
                paths: {},
                pkgs: {},
                shim: {},
                config: {}
            },
            registry = {},
            //registry of just enabled modules, to speed
            //cycle breaking code when lots of modules
            //are registered, but not activated.
            enabledRegistry = {},
            undefEvents = {},
            defQueue = [],
            defined = {},
            urlFetched = {},
            requireCounter = 1,
            unnormalizedCounter = 1;

        /**
         * Trims the . and .. from an array of path segments.
         * It will keep a leading path segment if a .. will become
         * the first path segment, to help with module name lookups,
         * which act like paths, but can be remapped. But the end result,
         * all paths that use this function should look normalized.
         * NOTE: this method MODIFIES the input array.
         * @param {Array} ary the array of path segments.
         */
        function trimDots(ary) {
            var i, part;
            for (i = 0; ary[i]; i += 1) {
                part = ary[i];
                if (part === '.') {
                    ary.splice(i, 1);
                    i -= 1;
                } else if (part === '..') {
                    if (i === 1 && (ary[2] === '..' || ary[0] === '..')) {
                        //End of the line. Keep at least one non-dot
                        //path segment at the front so it can be mapped
                        //correctly to disk. Otherwise, there is likely
                        //no path mapping for a path starting with '..'.
                        //This can still fail, but catches the most reasonable
                        //uses of ..
                        break;
                    } else if (i > 0) {
                        ary.splice(i - 1, 2);
                        i -= 2;
                    }
                }
            }
        }

        /**
         * Given a relative module name, like ./something, normalize it to
         * a real name that can be mapped to a path.
         * @param {String} name the relative name
         * @param {String} baseName a real name that the name arg is relative
         * to.
         * @param {Boolean} applyMap apply the map config to the value. Should
         * only be done if this normalization is for a dependency ID.
         * @returns {String} normalized name
         */
        function normalize(name, baseName, applyMap) {
            var pkgName, pkgConfig, mapValue, nameParts, i, j, nameSegment,
                foundMap, foundI, foundStarMap, starI,
                baseParts = baseName && baseName.split('/'),
                normalizedBaseParts = baseParts,
                map = config.map,
                starMap = map && map['*'];

            //Adjust any relative paths.
            if (name && name.charAt(0) === '.') {
                //If have a base name, try to normalize against it,
                //otherwise, assume it is a top-level require that will
                //be relative to baseUrl in the end.
                if (baseName) {
                    if (getOwn(config.pkgs, baseName)) {
                        //If the baseName is a package name, then just treat it as one
                        //name to concat the name with.
                        normalizedBaseParts = baseParts = [baseName];
                    } else {
                        //Convert baseName to array, and lop off the last part,
                        //so that . matches that 'directory' and not name of the baseName's
                        //module. For instance, baseName of 'one/two/three', maps to
                        //'one/two/three.js', but we want the directory, 'one/two' for
                        //this normalization.
                        normalizedBaseParts = baseParts.slice(0, baseParts.length - 1);
                    }

                    name = normalizedBaseParts.concat(name.split('/'));
                    trimDots(name);

                    //Some use of packages may use a . path to reference the
                    //'main' module name, so normalize for that.
                    pkgConfig = getOwn(config.pkgs, (pkgName = name[0]));
                    name = name.join('/');
                    if (pkgConfig && name === pkgName + '/' + pkgConfig.main) {
                        name = pkgName;
                    }
                } else if (name.indexOf('./') === 0) {
                    // No baseName, so this is ID is resolved relative
                    // to baseUrl, pull off the leading dot.
                    name = name.substring(2);
                }
            }

            //Apply map config if available.
            if (applyMap && map && (baseParts || starMap)) {
                nameParts = name.split('/');

                for (i = nameParts.length; i > 0; i -= 1) {
                    nameSegment = nameParts.slice(0, i).join('/');

                    if (baseParts) {
                        //Find the longest baseName segment match in the config.
                        //So, do joins on the biggest to smallest lengths of baseParts.
                        for (j = baseParts.length; j > 0; j -= 1) {
                            mapValue = getOwn(map, baseParts.slice(0, j).join('/'));

                            //baseName segment has config, find if it has one for
                            //this name.
                            if (mapValue) {
                                mapValue = getOwn(mapValue, nameSegment);
                                if (mapValue) {
                                    //Match, update name to the new value.
                                    foundMap = mapValue;
                                    foundI = i;
                                    break;
                                }
                            }
                        }
                    }

                    if (foundMap) {
                        break;
                    }

                    //Check for a star map match, but just hold on to it,
                    //if there is a shorter segment match later in a matching
                    //config, then favor over this star map.
                    if (!foundStarMap && starMap && getOwn(starMap, nameSegment)) {
                        foundStarMap = getOwn(starMap, nameSegment);
                        starI = i;
                    }
                }

                if (!foundMap && foundStarMap) {
                    foundMap = foundStarMap;
                    foundI = starI;
                }

                if (foundMap) {
                    nameParts.splice(0, foundI, foundMap);
                    name = nameParts.join('/');
                }
            }

            return name;
        }

        function removeScript(name) {
            if (isBrowser) {
                each(scripts(), function (scriptNode) {
                    if (scriptNode.getAttribute('data-requiremodule') === name &&
                            scriptNode.getAttribute('data-requirecontext') === context.contextName) {
                        scriptNode.parentNode.removeChild(scriptNode);
                        return true;
                    }
                });
            }
        }

        function hasPathFallback(id) {
            var pathConfig = getOwn(config.paths, id);
            if (pathConfig && isArray(pathConfig) && pathConfig.length > 1) {
                //Pop off the first array value, since it failed, and
                //retry
                pathConfig.shift();
                context.require.undef(id);
                context.require([id]);
                return true;
            }
        }

        //Turns a plugin!resource to [plugin, resource]
        //with the plugin being undefined if the name
        //did not have a plugin prefix.
        function splitPrefix(name) {
            var prefix,
                index = name ? name.indexOf('!') : -1;
            if (index > -1) {
                prefix = name.substring(0, index);
                name = name.substring(index + 1, name.length);
            }
            return [prefix, name];
        }

        /**
         * Creates a module mapping that includes plugin prefix, module
         * name, and path. If parentModuleMap is provided it will
         * also normalize the name via require.normalize()
         *
         * @param {String} name the module name
         * @param {String} [parentModuleMap] parent module map
         * for the module name, used to resolve relative names.
         * @param {Boolean} isNormalized: is the ID already normalized.
         * This is true if this call is done for a define() module ID.
         * @param {Boolean} applyMap: apply the map config to the ID.
         * Should only be true if this map is for a dependency.
         *
         * @returns {Object}
         */
        function makeModuleMap(name, parentModuleMap, isNormalized, applyMap) {
            var url, pluginModule, suffix, nameParts,
                prefix = null,
                parentName = parentModuleMap ? parentModuleMap.name : null,
                originalName = name,
                isDefine = true,
                normalizedName = '';

            //If no name, then it means it is a require call, generate an
            //internal name.
            if (!name) {
                isDefine = false;
                name = '_@r' + (requireCounter += 1);
            }

            nameParts = splitPrefix(name);
            prefix = nameParts[0];
            name = nameParts[1];

            if (prefix) {
                prefix = normalize(prefix, parentName, applyMap);
                pluginModule = getOwn(defined, prefix);
            }

            //Account for relative paths if there is a base name.
            if (name) {
                if (prefix) {
                    if (pluginModule && pluginModule.normalize) {
                        //Plugin is loaded, use its normalize method.
                        normalizedName = pluginModule.normalize(name, function (name) {
                            return normalize(name, parentName, applyMap);
                        });
                    } else {
                        normalizedName = normalize(name, parentName, applyMap);
                    }
                } else {
                    //A regular module.
                    normalizedName = normalize(name, parentName, applyMap);

                    //Normalized name may be a plugin ID due to map config
                    //application in normalize. The map config values must
                    //already be normalized, so do not need to redo that part.
                    nameParts = splitPrefix(normalizedName);
                    prefix = nameParts[0];
                    normalizedName = nameParts[1];
                    isNormalized = true;

                    url = context.nameToUrl(normalizedName);
                }
            }

            //If the id is a plugin id that cannot be determined if it needs
            //normalization, stamp it with a unique ID so two matching relative
            //ids that may conflict can be separate.
            suffix = prefix && !pluginModule && !isNormalized ?
                     '_unnormalized' + (unnormalizedCounter += 1) :
                     '';

            return {
                prefix: prefix,
                name: normalizedName,
                parentMap: parentModuleMap,
                unnormalized: !!suffix,
                url: url,
                originalName: originalName,
                isDefine: isDefine,
                id: (prefix ?
                        prefix + '!' + normalizedName :
                        normalizedName) + suffix
            };
        }

        function getModule(depMap) {
            var id = depMap.id,
                mod = getOwn(registry, id);

            if (!mod) {
                mod = registry[id] = new context.Module(depMap);
            }

            return mod;
        }

        function on(depMap, name, fn) {
            var id = depMap.id,
                mod = getOwn(registry, id);

            if (hasProp(defined, id) &&
                    (!mod || mod.defineEmitComplete)) {
                if (name === 'defined') {
                    fn(defined[id]);
                }
            } else {
                mod = getModule(depMap);
                if (mod.error && name === 'error') {
                    fn(mod.error);
                } else {
                    mod.on(name, fn);
                }
            }
        }

        function onError(err, errback) {
            var ids = err.requireModules,
                notified = false;

            if (errback) {
                errback(err);
            } else {
                each(ids, function (id) {
                    var mod = getOwn(registry, id);
                    if (mod) {
                        //Set error on module, so it skips timeout checks.
                        mod.error = err;
                        if (mod.events.error) {
                            notified = true;
                            mod.emit('error', err);
                        }
                    }
                });

                if (!notified) {
                    req.onError(err);
                }
            }
        }

        /**
         * Internal method to transfer globalQueue items to this context's
         * defQueue.
         */
        function takeGlobalQueue() {
            //Push all the globalDefQueue items into the context's defQueue
            if (globalDefQueue.length) {
                //Array splice in the values since the context code has a
                //local var ref to defQueue, so cannot just reassign the one
                //on context.
                apsp.apply(defQueue,
                           [defQueue.length - 1, 0].concat(globalDefQueue));
                globalDefQueue = [];
            }
        }

        handlers = {
            'require': function (mod) {
                if (mod.require) {
                    return mod.require;
                } else {
                    return (mod.require = context.makeRequire(mod.map));
                }
            },
            'exports': function (mod) {
                mod.usingExports = true;
                if (mod.map.isDefine) {
                    if (mod.exports) {
                        return mod.exports;
                    } else {
                        return (mod.exports = defined[mod.map.id] = {});
                    }
                }
            },
            'module': function (mod) {
                if (mod.module) {
                    return mod.module;
                } else {
                    return (mod.module = {
                        id: mod.map.id,
                        uri: mod.map.url,
                        config: function () {
                            var c,
                                pkg = getOwn(config.pkgs, mod.map.id);
                            // For packages, only support config targeted
                            // at the main module.
                            c = pkg ? getOwn(config.config, mod.map.id + '/' + pkg.main) :
                                      getOwn(config.config, mod.map.id);
                            return  c || {};
                        },
                        exports: defined[mod.map.id]
                    });
                }
            }
        };

        function cleanRegistry(id) {
            //Clean up machinery used for waiting modules.
            delete registry[id];
            delete enabledRegistry[id];
        }

        function breakCycle(mod, traced, processed) {
            var id = mod.map.id;

            if (mod.error) {
                mod.emit('error', mod.error);
            } else {
                traced[id] = true;
                each(mod.depMaps, function (depMap, i) {
                    var depId = depMap.id,
                        dep = getOwn(registry, depId);

                    //Only force things that have not completed
                    //being defined, so still in the registry,
                    //and only if it has not been matched up
                    //in the module already.
                    if (dep && !mod.depMatched[i] && !processed[depId]) {
                        if (getOwn(traced, depId)) {
                            mod.defineDep(i, defined[depId]);
                            mod.check(); //pass false?
                        } else {
                            breakCycle(dep, traced, processed);
                        }
                    }
                });
                processed[id] = true;
            }
        }

        function checkLoaded() {
            var map, modId, err, usingPathFallback,
                waitInterval = config.waitSeconds * 1000,
                //It is possible to disable the wait interval by using waitSeconds of 0.
                expired = waitInterval && (context.startTime + waitInterval) < new Date().getTime(),
                noLoads = [],
                reqCalls = [],
                stillLoading = false,
                needCycleCheck = true;

            //Do not bother if this call was a result of a cycle break.
            if (inCheckLoaded) {
                return;
            }

            inCheckLoaded = true;

            //Figure out the state of all the modules.
            eachProp(enabledRegistry, function (mod) {
                map = mod.map;
                modId = map.id;

                //Skip things that are not enabled or in error state.
                if (!mod.enabled) {
                    return;
                }

                if (!map.isDefine) {
                    reqCalls.push(mod);
                }

                if (!mod.error) {
                    //If the module should be executed, and it has not
                    //been inited and time is up, remember it.
                    if (!mod.inited && expired) {
                        if (hasPathFallback(modId)) {
                            usingPathFallback = true;
                            stillLoading = true;
                        } else {
                            noLoads.push(modId);
                            removeScript(modId);
                        }
                    } else if (!mod.inited && mod.fetched && map.isDefine) {
                        stillLoading = true;
                        if (!map.prefix) {
                            //No reason to keep looking for unfinished
                            //loading. If the only stillLoading is a
                            //plugin resource though, keep going,
                            //because it may be that a plugin resource
                            //is waiting on a non-plugin cycle.
                            return (needCycleCheck = false);
                        }
                    }
                }
            });

            if (expired && noLoads.length) {
                //If wait time expired, throw error of unloaded modules.
                err = makeError('timeout', 'Load timeout for modules: ' + noLoads, null, noLoads);
                err.contextName = context.contextName;
                return onError(err);
            }

            //Not expired, check for a cycle.
            if (needCycleCheck) {
                each(reqCalls, function (mod) {
                    breakCycle(mod, {}, {});
                });
            }

            //If still waiting on loads, and the waiting load is something
            //other than a plugin resource, or there are still outstanding
            //scripts, then just try back later.
            if ((!expired || usingPathFallback) && stillLoading) {
                //Something is still waiting to load. Wait for it, but only
                //if a timeout is not already in effect.
                if ((isBrowser || isWebWorker) && !checkLoadedTimeoutId) {
                    checkLoadedTimeoutId = setTimeout(function () {
                        checkLoadedTimeoutId = 0;
                        checkLoaded();
                    }, 50);
                }
            }

            inCheckLoaded = false;
        }

        Module = function (map) {
            this.events = getOwn(undefEvents, map.id) || {};
            this.map = map;
            this.shim = getOwn(config.shim, map.id);
            this.depExports = [];
            this.depMaps = [];
            this.depMatched = [];
            this.pluginMaps = {};
            this.depCount = 0;

            /* this.exports this.factory
               this.depMaps = [],
               this.enabled, this.fetched
            */
        };

        Module.prototype = {
            init: function (depMaps, factory, errback, options) {
                options = options || {};

                //Do not do more inits if already done. Can happen if there
                //are multiple define calls for the same module. That is not
                //a normal, common case, but it is also not unexpected.
                if (this.inited) {
                    return;
                }

                this.factory = factory;

                if (errback) {
                    //Register for errors on this module.
                    this.on('error', errback);
                } else if (this.events.error) {
                    //If no errback already, but there are error listeners
                    //on this module, set up an errback to pass to the deps.
                    errback = bind(this, function (err) {
                        this.emit('error', err);
                    });
                }

                //Do a copy of the dependency array, so that
                //source inputs are not modified. For example
                //"shim" deps are passed in here directly, and
                //doing a direct modification of the depMaps array
                //would affect that config.
                this.depMaps = depMaps && depMaps.slice(0);

                this.errback = errback;

                //Indicate this module has be initialized
                this.inited = true;

                this.ignore = options.ignore;

                //Could have option to init this module in enabled mode,
                //or could have been previously marked as enabled. However,
                //the dependencies are not known until init is called. So
                //if enabled previously, now trigger dependencies as enabled.
                if (options.enabled || this.enabled) {
                    //Enable this module and dependencies.
                    //Will call this.check()
                    this.enable();
                } else {
                    this.check();
                }
            },

            defineDep: function (i, depExports) {
                //Because of cycles, defined callback for a given
                //export can be called more than once.
                if (!this.depMatched[i]) {
                    this.depMatched[i] = true;
                    this.depCount -= 1;
                    this.depExports[i] = depExports;
                }
            },

            fetch: function () {
                if (this.fetched) {
                    return;
                }
                this.fetched = true;

                context.startTime = (new Date()).getTime();

                var map = this.map;

                //If the manager is for a plugin managed resource,
                //ask the plugin to load it now.
                if (this.shim) {
                    context.makeRequire(this.map, {
                        enableBuildCallback: true
                    })(this.shim.deps || [], bind(this, function () {
                        return map.prefix ? this.callPlugin() : this.load();
                    }));
                } else {
                    //Regular dependency.
                    return map.prefix ? this.callPlugin() : this.load();
                }
            },

            load: function () {
                var url = this.map.url;

                //Regular dependency.
                if (!urlFetched[url]) {
                    urlFetched[url] = true;
                    context.load(this.map.id, url);
                }
            },

            /**
             * Checks if the module is ready to define itself, and if so,
             * define it.
             */
            check: function () {
                if (!this.enabled || this.enabling) {
                    return;
                }

                var err, cjsModule,
                    id = this.map.id,
                    depExports = this.depExports,
                    exports = this.exports,
                    factory = this.factory;

                if (!this.inited) {
                    this.fetch();
                } else if (this.error) {
                    this.emit('error', this.error);
                } else if (!this.defining) {
                    //The factory could trigger another require call
                    //that would result in checking this module to
                    //define itself again. If already in the process
                    //of doing that, skip this work.
                    this.defining = true;

                    if (this.depCount < 1 && !this.defined) {
                        if (isFunction(factory)) {
                            //If there is an error listener, favor passing
                            //to that instead of throwing an error. However,
                            //only do it for define()'d  modules. require
                            //errbacks should not be called for failures in
                            //their callbacks (#699). However if a global
                            //onError is set, use that.
                            if ((this.events.error && this.map.isDefine) ||
                                req.onError !== defaultOnError) {
                                try {
                                    exports = context.execCb(id, factory, depExports, exports);
                                } catch (e) {
                                    err = e;
                                }
                            } else {
                                exports = context.execCb(id, factory, depExports, exports);
                            }

                            if (this.map.isDefine) {
                                //If setting exports via 'module' is in play,
                                //favor that over return value and exports. After that,
                                //favor a non-undefined return value over exports use.
                                cjsModule = this.module;
                                if (cjsModule &&
                                        cjsModule.exports !== undefined &&
                                        //Make sure it is not already the exports value
                                        cjsModule.exports !== this.exports) {
                                    exports = cjsModule.exports;
                                } else if (exports === undefined && this.usingExports) {
                                    //exports already set the defined value.
                                    exports = this.exports;
                                }
                            }

                            if (err) {
                                err.requireMap = this.map;
                                err.requireModules = this.map.isDefine ? [this.map.id] : null;
                                err.requireType = this.map.isDefine ? 'define' : 'require';
                                return onError((this.error = err));
                            }

                        } else {
                            //Just a literal value
                            exports = factory;
                        }

                        this.exports = exports;

                        if (this.map.isDefine && !this.ignore) {
                            defined[id] = exports;

                            if (req.onResourceLoad) {
                                req.onResourceLoad(context, this.map, this.depMaps);
                            }
                        }

                        //Clean up
                        cleanRegistry(id);

                        this.defined = true;
                    }

                    //Finished the define stage. Allow calling check again
                    //to allow define notifications below in the case of a
                    //cycle.
                    this.defining = false;

                    if (this.defined && !this.defineEmitted) {
                        this.defineEmitted = true;
                        this.emit('defined', this.exports);
                        this.defineEmitComplete = true;
                    }

                }
            },

            callPlugin: function () {
                var map = this.map,
                    id = map.id,
                    //Map already normalized the prefix.
                    pluginMap = makeModuleMap(map.prefix);

                //Mark this as a dependency for this plugin, so it
                //can be traced for cycles.
                this.depMaps.push(pluginMap);

                on(pluginMap, 'defined', bind(this, function (plugin) {
                    var load, normalizedMap, normalizedMod,
                        name = this.map.name,
                        parentName = this.map.parentMap ? this.map.parentMap.name : null,
                        localRequire = context.makeRequire(map.parentMap, {
                            enableBuildCallback: true
                        });

                    //If current map is not normalized, wait for that
                    //normalized name to load instead of continuing.
                    if (this.map.unnormalized) {
                        //Normalize the ID if the plugin allows it.
                        if (plugin.normalize) {
                            name = plugin.normalize(name, function (name) {
                                return normalize(name, parentName, true);
                            }) || '';
                        }

                        //prefix and name should already be normalized, no need
                        //for applying map config again either.
                        normalizedMap = makeModuleMap(map.prefix + '!' + name,
                                                      this.map.parentMap);
                        on(normalizedMap,
                            'defined', bind(this, function (value) {
                                this.init([], function () { return value; }, null, {
                                    enabled: true,
                                    ignore: true
                                });
                            }));

                        normalizedMod = getOwn(registry, normalizedMap.id);
                        if (normalizedMod) {
                            //Mark this as a dependency for this plugin, so it
                            //can be traced for cycles.
                            this.depMaps.push(normalizedMap);

                            if (this.events.error) {
                                normalizedMod.on('error', bind(this, function (err) {
                                    this.emit('error', err);
                                }));
                            }
                            normalizedMod.enable();
                        }

                        return;
                    }

                    load = bind(this, function (value) {
                        this.init([], function () { return value; }, null, {
                            enabled: true
                        });
                    });

                    load.error = bind(this, function (err) {
                        this.inited = true;
                        this.error = err;
                        err.requireModules = [id];

                        //Remove temp unnormalized modules for this module,
                        //since they will never be resolved otherwise now.
                        eachProp(registry, function (mod) {
                            if (mod.map.id.indexOf(id + '_unnormalized') === 0) {
                                cleanRegistry(mod.map.id);
                            }
                        });

                        onError(err);
                    });

                    //Allow plugins to load other code without having to know the
                    //context or how to 'complete' the load.
                    load.fromText = bind(this, function (text, textAlt) {
                        /*jslint evil: true */
                        var moduleName = map.name,
                            moduleMap = makeModuleMap(moduleName),
                            hasInteractive = useInteractive;

                        //As of 2.1.0, support just passing the text, to reinforce
                        //fromText only being called once per resource. Still
                        //support old style of passing moduleName but discard
                        //that moduleName in favor of the internal ref.
                        if (textAlt) {
                            text = textAlt;
                        }

                        //Turn off interactive script matching for IE for any define
                        //calls in the text, then turn it back on at the end.
                        if (hasInteractive) {
                            useInteractive = false;
                        }

                        //Prime the system by creating a module instance for
                        //it.
                        getModule(moduleMap);

                        //Transfer any config to this other module.
                        if (hasProp(config.config, id)) {
                            config.config[moduleName] = config.config[id];
                        }

                        try {
                            req.exec(text);
                        } catch (e) {
                            return onError(makeError('fromtexteval',
                                             'fromText eval for ' + id +
                                            ' failed: ' + e,
                                             e,
                                             [id]));
                        }

                        if (hasInteractive) {
                            useInteractive = true;
                        }

                        //Mark this as a dependency for the plugin
                        //resource
                        this.depMaps.push(moduleMap);

                        //Support anonymous modules.
                        context.completeLoad(moduleName);

                        //Bind the value of that module to the value for this
                        //resource ID.
                        localRequire([moduleName], load);
                    });

                    //Use parentName here since the plugin's name is not reliable,
                    //could be some weird string with no path that actually wants to
                    //reference the parentName's path.
                    plugin.load(map.name, localRequire, load, config);
                }));

                context.enable(pluginMap, this);
                this.pluginMaps[pluginMap.id] = pluginMap;
            },

            enable: function () {
                enabledRegistry[this.map.id] = this;
                this.enabled = true;

                //Set flag mentioning that the module is enabling,
                //so that immediate calls to the defined callbacks
                //for dependencies do not trigger inadvertent load
                //with the depCount still being zero.
                this.enabling = true;

                //Enable each dependency
                each(this.depMaps, bind(this, function (depMap, i) {
                    var id, mod, handler;

                    if (typeof depMap === 'string') {
                        //Dependency needs to be converted to a depMap
                        //and wired up to this module.
                        depMap = makeModuleMap(depMap,
                                               (this.map.isDefine ? this.map : this.map.parentMap),
                                               false,
                                               !this.skipMap);
                        this.depMaps[i] = depMap;

                        handler = getOwn(handlers, depMap.id);

                        if (handler) {
                            this.depExports[i] = handler(this);
                            return;
                        }

                        this.depCount += 1;

                        on(depMap, 'defined', bind(this, function (depExports) {
                            this.defineDep(i, depExports);
                            this.check();
                        }));

                        if (this.errback) {
                            on(depMap, 'error', bind(this, this.errback));
                        }
                    }

                    id = depMap.id;
                    mod = registry[id];

                    //Skip special modules like 'require', 'exports', 'module'
                    //Also, don't call enable if it is already enabled,
                    //important in circular dependency cases.
                    if (!hasProp(handlers, id) && mod && !mod.enabled) {
                        context.enable(depMap, this);
                    }
                }));

                //Enable each plugin that is used in
                //a dependency
                eachProp(this.pluginMaps, bind(this, function (pluginMap) {
                    var mod = getOwn(registry, pluginMap.id);
                    if (mod && !mod.enabled) {
                        context.enable(pluginMap, this);
                    }
                }));

                this.enabling = false;

                this.check();
            },

            on: function (name, cb) {
                var cbs = this.events[name];
                if (!cbs) {
                    cbs = this.events[name] = [];
                }
                cbs.push(cb);
            },

            emit: function (name, evt) {
                each(this.events[name], function (cb) {
                    cb(evt);
                });
                if (name === 'error') {
                    //Now that the error handler was triggered, remove
                    //the listeners, since this broken Module instance
                    //can stay around for a while in the registry.
                    delete this.events[name];
                }
            }
        };

        function callGetModule(args) {
            //Skip modules already defined.
            if (!hasProp(defined, args[0])) {
                getModule(makeModuleMap(args[0], null, true)).init(args[1], args[2]);
            }
        }

        function removeListener(node, func, name, ieName) {
            //Favor detachEvent because of IE9
            //issue, see attachEvent/addEventListener comment elsewhere
            //in this file.
            if (node.detachEvent && !isOpera) {
                //Probably IE. If not it will throw an error, which will be
                //useful to know.
                if (ieName) {
                    node.detachEvent(ieName, func);
                }
            } else {
                node.removeEventListener(name, func, false);
            }
        }

        /**
         * Given an event from a script node, get the requirejs info from it,
         * and then removes the event listeners on the node.
         * @param {Event} evt
         * @returns {Object}
         */
        function getScriptData(evt) {
            //Using currentTarget instead of target for Firefox 2.0's sake. Not
            //all old browsers will be supported, but this one was easy enough
            //to support and still makes sense.
            var node = evt.currentTarget || evt.srcElement;

            //Remove the listeners once here.
            removeListener(node, context.onScriptLoad, 'load', 'onreadystatechange');
            removeListener(node, context.onScriptError, 'error');

            return {
                node: node,
                id: node && node.getAttribute('data-requiremodule')
            };
        }

        function intakeDefines() {
            var args;

            //Any defined modules in the global queue, intake them now.
            takeGlobalQueue();

            //Make sure any remaining defQueue items get properly processed.
            while (defQueue.length) {
                args = defQueue.shift();
                if (args[0] === null) {
                    return onError(makeError('mismatch', 'Mismatched anonymous define() module: ' + args[args.length - 1]));
                } else {
                    //args are id, deps, factory. Should be normalized by the
                    //define() function.
                    callGetModule(args);
                }
            }
        }

        context = {
            config: config,
            contextName: contextName,
            registry: registry,
            defined: defined,
            urlFetched: urlFetched,
            defQueue: defQueue,
            Module: Module,
            makeModuleMap: makeModuleMap,
            nextTick: req.nextTick,
            onError: onError,

            /**
             * Set a configuration for the context.
             * @param {Object} cfg config object to integrate.
             */
            configure: function (cfg) {
                //Make sure the baseUrl ends in a slash.
                if (cfg.baseUrl) {
                    if (cfg.baseUrl.charAt(cfg.baseUrl.length - 1) !== '/') {
                        cfg.baseUrl += '/';
                    }
                }

                //Save off the paths and packages since they require special processing,
                //they are additive.
                var pkgs = config.pkgs,
                    shim = config.shim,
                    objs = {
                        paths: true,
                        config: true,
                        map: true
                    };

                eachProp(cfg, function (value, prop) {
                    if (objs[prop]) {
                        if (prop === 'map') {
                            if (!config.map) {
                                config.map = {};
                            }
                            mixin(config[prop], value, true, true);
                        } else {
                            mixin(config[prop], value, true);
                        }
                    } else {
                        config[prop] = value;
                    }
                });

                //Merge shim
                if (cfg.shim) {
                    eachProp(cfg.shim, function (value, id) {
                        //Normalize the structure
                        if (isArray(value)) {
                            value = {
                                deps: value
                            };
                        }
                        if ((value.exports || value.init) && !value.exportsFn) {
                            value.exportsFn = context.makeShimExports(value);
                        }
                        shim[id] = value;
                    });
                    config.shim = shim;
                }

                //Adjust packages if necessary.
                if (cfg.packages) {
                    each(cfg.packages, function (pkgObj) {
                        var location;

                        pkgObj = typeof pkgObj === 'string' ? { name: pkgObj } : pkgObj;
                        location = pkgObj.location;

                        //Create a brand new object on pkgs, since currentPackages can
                        //be passed in again, and config.pkgs is the internal transformed
                        //state for all package configs.
                        pkgs[pkgObj.name] = {
                            name: pkgObj.name,
                            location: location || pkgObj.name,
                            //Remove leading dot in main, so main paths are normalized,
                            //and remove any trailing .js, since different package
                            //envs have different conventions: some use a module name,
                            //some use a file name.
                            main: (pkgObj.main || 'main')
                                  .replace(currDirRegExp, '')
                                  .replace(jsSuffixRegExp, '')
                        };
                    });

                    //Done with modifications, assing packages back to context config
                    config.pkgs = pkgs;
                }

                //If there are any "waiting to execute" modules in the registry,
                //update the maps for them, since their info, like URLs to load,
                //may have changed.
                eachProp(registry, function (mod, id) {
                    //If module already has init called, since it is too
                    //late to modify them, and ignore unnormalized ones
                    //since they are transient.
                    if (!mod.inited && !mod.map.unnormalized) {
                        mod.map = makeModuleMap(id);
                    }
                });

                //If a deps array or a config callback is specified, then call
                //require with those args. This is useful when require is defined as a
                //config object before require.js is loaded.
                if (cfg.deps || cfg.callback) {
                    context.require(cfg.deps || [], cfg.callback);
                }
            },

            makeShimExports: function (value) {
                function fn() {
                    var ret;
                    if (value.init) {
                        ret = value.init.apply(global, arguments);
                    }
                    return ret || (value.exports && getGlobal(value.exports));
                }
                return fn;
            },

            makeRequire: function (relMap, options) {
                options = options || {};

                function localRequire(deps, callback, errback) {
                    var id, map, requireMod;

                    if (options.enableBuildCallback && callback && isFunction(callback)) {
                        callback.__requireJsBuild = true;
                    }

                    if (typeof deps === 'string') {
                        if (isFunction(callback)) {
                            //Invalid call
                            return onError(makeError('requireargs', 'Invalid require call'), errback);
                        }

                        //If require|exports|module are requested, get the
                        //value for them from the special handlers. Caveat:
                        //this only works while module is being defined.
                        if (relMap && hasProp(handlers, deps)) {
                            return handlers[deps](registry[relMap.id]);
                        }

                        //Synchronous access to one module. If require.get is
                        //available (as in the Node adapter), prefer that.
                        if (req.get) {
                            return req.get(context, deps, relMap, localRequire);
                        }

                        //Normalize module name, if it contains . or ..
                        map = makeModuleMap(deps, relMap, false, true);
                        id = map.id;

                        if (!hasProp(defined, id)) {
                            return onError(makeError('notloaded', 'Module name "' +
                                        id +
                                        '" has not been loaded yet for context: ' +
                                        contextName +
                                        (relMap ? '' : '. Use require([])')));
                        }
                        return defined[id];
                    }

                    //Grab defines waiting in the global queue.
                    intakeDefines();

                    //Mark all the dependencies as needing to be loaded.
                    context.nextTick(function () {
                        //Some defines could have been added since the
                        //require call, collect them.
                        intakeDefines();

                        requireMod = getModule(makeModuleMap(null, relMap));

                        //Store if map config should be applied to this require
                        //call for dependencies.
                        requireMod.skipMap = options.skipMap;

                        requireMod.init(deps, callback, errback, {
                            enabled: true
                        });

                        checkLoaded();
                    });

                    return localRequire;
                }

                mixin(localRequire, {
                    isBrowser: isBrowser,

                    /**
                     * Converts a module name + .extension into an URL path.
                     * *Requires* the use of a module name. It does not support using
                     * plain URLs like nameToUrl.
                     */
                    toUrl: function (moduleNamePlusExt) {
                        var ext,
                            index = moduleNamePlusExt.lastIndexOf('.'),
                            segment = moduleNamePlusExt.split('/')[0],
                            isRelative = segment === '.' || segment === '..';

                        //Have a file extension alias, and it is not the
                        //dots from a relative path.
                        if (index !== -1 && (!isRelative || index > 1)) {
                            ext = moduleNamePlusExt.substring(index, moduleNamePlusExt.length);
                            moduleNamePlusExt = moduleNamePlusExt.substring(0, index);
                        }

                        return context.nameToUrl(normalize(moduleNamePlusExt,
                                                relMap && relMap.id, true), ext,  true);
                    },

                    defined: function (id) {
                        return hasProp(defined, makeModuleMap(id, relMap, false, true).id);
                    },

                    specified: function (id) {
                        id = makeModuleMap(id, relMap, false, true).id;
                        return hasProp(defined, id) || hasProp(registry, id);
                    }
                });

                //Only allow undef on top level require calls
                if (!relMap) {
                    localRequire.undef = function (id) {
                        //Bind any waiting define() calls to this context,
                        //fix for #408
                        takeGlobalQueue();

                        var map = makeModuleMap(id, relMap, true),
                            mod = getOwn(registry, id);

                        removeScript(id);

                        delete defined[id];
                        delete urlFetched[map.url];
                        delete undefEvents[id];

                        if (mod) {
                            //Hold on to listeners in case the
                            //module will be attempted to be reloaded
                            //using a different config.
                            if (mod.events.defined) {
                                undefEvents[id] = mod.events;
                            }

                            cleanRegistry(id);
                        }
                    };
                }

                return localRequire;
            },

            /**
             * Called to enable a module if it is still in the registry
             * awaiting enablement. A second arg, parent, the parent module,
             * is passed in for context, when this method is overriden by
             * the optimizer. Not shown here to keep code compact.
             */
            enable: function (depMap) {
                var mod = getOwn(registry, depMap.id);
                if (mod) {
                    getModule(depMap).enable();
                }
            },

            /**
             * Internal method used by environment adapters to complete a load event.
             * A load event could be a script load or just a load pass from a synchronous
             * load call.
             * @param {String} moduleName the name of the module to potentially complete.
             */
            completeLoad: function (moduleName) {
                var found, args, mod,
                    shim = getOwn(config.shim, moduleName) || {},
                    shExports = shim.exports;

                takeGlobalQueue();

                while (defQueue.length) {
                    args = defQueue.shift();
                    if (args[0] === null) {
                        args[0] = moduleName;
                        //If already found an anonymous module and bound it
                        //to this name, then this is some other anon module
                        //waiting for its completeLoad to fire.
                        if (found) {
                            break;
                        }
                        found = true;
                    } else if (args[0] === moduleName) {
                        //Found matching define call for this script!
                        found = true;
                    }

                    callGetModule(args);
                }

                //Do this after the cycle of callGetModule in case the result
                //of those calls/init calls changes the registry.
                mod = getOwn(registry, moduleName);

                if (!found && !hasProp(defined, moduleName) && mod && !mod.inited) {
                    if (config.enforceDefine && (!shExports || !getGlobal(shExports))) {
                        if (hasPathFallback(moduleName)) {
                            return;
                        } else {
                            return onError(makeError('nodefine',
                                             'No define call for ' + moduleName,
                                             null,
                                             [moduleName]));
                        }
                    } else {
                        //A script that does not call define(), so just simulate
                        //the call for it.
                        callGetModule([moduleName, (shim.deps || []), shim.exportsFn]);
                    }
                }

                checkLoaded();
            },

            /**
             * Converts a module name to a file path. Supports cases where
             * moduleName may actually be just an URL.
             * Note that it **does not** call normalize on the moduleName,
             * it is assumed to have already been normalized. This is an
             * internal API, not a public one. Use toUrl for the public API.
             */
            nameToUrl: function (moduleName, ext, skipExt) {
                var paths, pkgs, pkg, pkgPath, syms, i, parentModule, url,
                    parentPath;

                //If a colon is in the URL, it indicates a protocol is used and it is just
                //an URL to a file, or if it starts with a slash, contains a query arg (i.e. ?)
                //or ends with .js, then assume the user meant to use an url and not a module id.
                //The slash is important for protocol-less URLs as well as full paths.
                if (req.jsExtRegExp.test(moduleName)) {
                    //Just a plain path, not module name lookup, so just return it.
                    //Add extension if it is included. This is a bit wonky, only non-.js things pass
                    //an extension, this method probably needs to be reworked.
                    url = moduleName + (ext || '');
                } else {
                    //A module that needs to be converted to a path.
                    paths = config.paths;
                    pkgs = config.pkgs;

                    syms = moduleName.split('/');
                    //For each module name segment, see if there is a path
                    //registered for it. Start with most specific name
                    //and work up from it.
                    for (i = syms.length; i > 0; i -= 1) {
                        parentModule = syms.slice(0, i).join('/');
                        pkg = getOwn(pkgs, parentModule);
                        parentPath = getOwn(paths, parentModule);
                        if (parentPath) {
                            //If an array, it means there are a few choices,
                            //Choose the one that is desired
                            if (isArray(parentPath)) {
                                parentPath = parentPath[0];
                            }
                            syms.splice(0, i, parentPath);
                            break;
                        } else if (pkg) {
                            //If module name is just the package name, then looking
                            //for the main module.
                            if (moduleName === pkg.name) {
                                pkgPath = pkg.location + '/' + pkg.main;
                            } else {
                                pkgPath = pkg.location;
                            }
                            syms.splice(0, i, pkgPath);
                            break;
                        }
                    }

                    //Join the path parts together, then figure out if baseUrl is needed.
                    url = syms.join('/');
                    url += (ext || (/^data\:|\?/.test(url) || skipExt ? '' : '.js'));
                    url = (url.charAt(0) === '/' || url.match(/^[\w\+\.\-]+:/) ? '' : config.baseUrl) + url;
                }

                return config.urlArgs ? url +
                                        ((url.indexOf('?') === -1 ? '?' : '&') +
                                         config.urlArgs) : url;
            },

            //Delegates to req.load. Broken out as a separate function to
            //allow overriding in the optimizer.
            load: function (id, url) {
                req.load(context, id, url);
            },

            /**
             * Executes a module callback function. Broken out as a separate function
             * solely to allow the build system to sequence the files in the built
             * layer in the right sequence.
             *
             * @private
             */
            execCb: function (name, callback, args, exports) {
                return callback.apply(exports, args);
            },

            /**
             * callback for script loads, used to check status of loading.
             *
             * @param {Event} evt the event from the browser for the script
             * that was loaded.
             */
            onScriptLoad: function (evt) {
                //Using currentTarget instead of target for Firefox 2.0's sake. Not
                //all old browsers will be supported, but this one was easy enough
                //to support and still makes sense.
                if (evt.type === 'load' ||
                        (readyRegExp.test((evt.currentTarget || evt.srcElement).readyState))) {
                    //Reset interactive script so a script node is not held onto for
                    //to long.
                    interactiveScript = null;

                    //Pull out the name of the module and the context.
                    var data = getScriptData(evt);
                    context.completeLoad(data.id);
                }
            },

            /**
             * Callback for script errors.
             */
            onScriptError: function (evt) {
                var data = getScriptData(evt);
                if (!hasPathFallback(data.id)) {
                    return onError(makeError('scripterror', 'Script error for: ' + data.id, evt, [data.id]));
                }
            }
        };

        context.require = context.makeRequire();
        return context;
    }

    /**
     * Main entry point.
     *
     * If the only argument to require is a string, then the module that
     * is represented by that string is fetched for the appropriate context.
     *
     * If the first argument is an array, then it will be treated as an array
     * of dependency string names to fetch. An optional function callback can
     * be specified to execute when all of those dependencies are available.
     *
     * Make a local req variable to help Caja compliance (it assumes things
     * on a require that are not standardized), and to give a short
     * name for minification/local scope use.
     */
    req = requirejs = function (deps, callback, errback, optional) {

        //Find the right context, use default
        var context, config,
            contextName = defContextName;

        // Determine if have config object in the call.
        if (!isArray(deps) && typeof deps !== 'string') {
            // deps is a config object
            config = deps;
            if (isArray(callback)) {
                // Adjust args if there are dependencies
                deps = callback;
                callback = errback;
                errback = optional;
            } else {
                deps = [];
            }
        }

        if (config && config.context) {
            contextName = config.context;
        }

        context = getOwn(contexts, contextName);
        if (!context) {
            context = contexts[contextName] = req.s.newContext(contextName);
        }

        if (config) {
            context.configure(config);
        }

        return context.require(deps, callback, errback);
    };

    /**
     * Support require.config() to make it easier to cooperate with other
     * AMD loaders on globally agreed names.
     */
    req.config = function (config) {
        return req(config);
    };

    /**
     * Execute something after the current tick
     * of the event loop. Override for other envs
     * that have a better solution than setTimeout.
     * @param  {Function} fn function to execute later.
     */
    req.nextTick = typeof setTimeout !== 'undefined' ? function (fn) {
        setTimeout(fn, 4);
    } : function (fn) { fn(); };

    /**
     * Export require as a global, but only if it does not already exist.
     */
    if (!require) {
        require = req;
    }

    req.version = version;

    //Used to filter out dependencies that are already paths.
    req.jsExtRegExp = /^\/|:|\?|\.js$/;
    req.isBrowser = isBrowser;
    s = req.s = {
        contexts: contexts,
        newContext: newContext
    };

    //Create default context.
    req({});

    //Exports some context-sensitive methods on global require.
    each([
        'toUrl',
        'undef',
        'defined',
        'specified'
    ], function (prop) {
        //Reference from contexts instead of early binding to default context,
        //so that during builds, the latest instance of the default context
        //with its config gets used.
        req[prop] = function () {
            var ctx = contexts[defContextName];
            return ctx.require[prop].apply(ctx, arguments);
        };
    });

    if (isBrowser) {
        head = s.head = document.getElementsByTagName('head')[0];
        //If BASE tag is in play, using appendChild is a problem for IE6.
        //When that browser dies, this can be removed. Details in this jQuery bug:
        //http://dev.jquery.com/ticket/2709
        baseElement = document.getElementsByTagName('base')[0];
        if (baseElement) {
            head = s.head = baseElement.parentNode;
        }
    }

    /**
     * Any errors that require explicitly generates will be passed to this
     * function. Intercept/override it if you want custom error handling.
     * @param {Error} err the error object.
     */
    req.onError = defaultOnError;

    /**
     * Creates the node for the load command. Only used in browser envs.
     */
    req.createNode = function (config, moduleName, url) {
        var node = config.xhtml ?
                document.createElementNS('http://www.w3.org/1999/xhtml', 'html:script') :
                document.createElement('script');
        node.type = config.scriptType || 'text/javascript';
        node.charset = 'utf-8';
        node.async = true;
        return node;
    };

    /**
     * Does the request to load a module for the browser case.
     * Make this a separate function to allow other environments
     * to override it.
     *
     * @param {Object} context the require context to find state.
     * @param {String} moduleName the name of the module.
     * @param {Object} url the URL to the module.
     */
    req.load = function (context, moduleName, url) {
        var config = (context && context.config) || {},
            node;
        if (isBrowser) {
            //In the browser so use a script tag
            node = req.createNode(config, moduleName, url);

            node.setAttribute('data-requirecontext', context.contextName);
            node.setAttribute('data-requiremodule', moduleName);

            //Set up load listener. Test attachEvent first because IE9 has
            //a subtle issue in its addEventListener and script onload firings
            //that do not match the behavior of all other browsers with
            //addEventListener support, which fire the onload event for a
            //script right after the script execution. See:
            //https://connect.microsoft.com/IE/feedback/details/648057/script-onload-event-is-not-fired-immediately-after-script-execution
            //UNFORTUNATELY Opera implements attachEvent but does not follow the script
            //script execution mode.
            if (node.attachEvent &&
                    //Check if node.attachEvent is artificially added by custom script or
                    //natively supported by browser
                    //read https://github.com/jrburke/requirejs/issues/187
                    //if we can NOT find [native code] then it must NOT natively supported.
                    //in IE8, node.attachEvent does not have toString()
                    //Note the test for "[native code" with no closing brace, see:
                    //https://github.com/jrburke/requirejs/issues/273
                    !(node.attachEvent.toString && node.attachEvent.toString().indexOf('[native code') < 0) &&
                    !isOpera) {
                //Probably IE. IE (at least 6-8) do not fire
                //script onload right after executing the script, so
                //we cannot tie the anonymous define call to a name.
                //However, IE reports the script as being in 'interactive'
                //readyState at the time of the define call.
                useInteractive = true;

                node.attachEvent('onreadystatechange', context.onScriptLoad);
                //It would be great to add an error handler here to catch
                //404s in IE9+. However, onreadystatechange will fire before
                //the error handler, so that does not help. If addEventListener
                //is used, then IE will fire error before load, but we cannot
                //use that pathway given the connect.microsoft.com issue
                //mentioned above about not doing the 'script execute,
                //then fire the script load event listener before execute
                //next script' that other browsers do.
                //Best hope: IE10 fixes the issues,
                //and then destroys all installs of IE 6-9.
                //node.attachEvent('onerror', context.onScriptError);
            } else {
                node.addEventListener('load', context.onScriptLoad, false);
                node.addEventListener('error', context.onScriptError, false);
            }
            node.src = url;

            //For some cache cases in IE 6-8, the script executes before the end
            //of the appendChild execution, so to tie an anonymous define
            //call to the module name (which is stored on the node), hold on
            //to a reference to this node, but clear after the DOM insertion.
            currentlyAddingScript = node;
            if (baseElement) {
                head.insertBefore(node, baseElement);
            } else {
                head.appendChild(node);
            }
            currentlyAddingScript = null;

            return node;
        } else if (isWebWorker) {
            try {
                //In a web worker, use importScripts. This is not a very
                //efficient use of importScripts, importScripts will block until
                //its script is downloaded and evaluated. However, if web workers
                //are in play, the expectation that a build has been done so that
                //only one script needs to be loaded anyway. This may need to be
                //reevaluated if other use cases become common.
                importScripts(url);

                //Account for anonymous modules
                context.completeLoad(moduleName);
            } catch (e) {
                context.onError(makeError('importscripts',
                                'importScripts failed for ' +
                                    moduleName + ' at ' + url,
                                e,
                                [moduleName]));
            }
        }
    };

    function getInteractiveScript() {
        if (interactiveScript && interactiveScript.readyState === 'interactive') {
            return interactiveScript;
        }

        eachReverse(scripts(), function (script) {
            if (script.readyState === 'interactive') {
                return (interactiveScript = script);
            }
        });
        return interactiveScript;
    }

    //Look for a data-main script attribute, which could also adjust the baseUrl.
    if (isBrowser && !cfg.skipDataMain) {
        //Figure out baseUrl. Get it from the script tag with require.js in it.
        eachReverse(scripts(), function (script) {
            //Set the 'head' where we can append children by
            //using the script's parent.
            if (!head) {
                head = script.parentNode;
            }

            //Look for a data-main attribute to set main script for the page
            //to load. If it is there, the path to data main becomes the
            //baseUrl, if it is not already set.
            dataMain = script.getAttribute('data-main');
            if (dataMain) {
                //Preserve dataMain in case it is a path (i.e. contains '?')
                mainScript = dataMain;

                //Set final baseUrl if there is not already an explicit one.
                if (!cfg.baseUrl) {
                    //Pull off the directory of data-main for use as the
                    //baseUrl.
                    src = mainScript.split('/');
                    mainScript = src.pop();
                    subPath = src.length ? src.join('/')  + '/' : './';

                    cfg.baseUrl = subPath;
                }

                //Strip off any trailing .js since mainScript is now
                //like a module name.
                mainScript = mainScript.replace(jsSuffixRegExp, '');

                 //If mainScript is still a path, fall back to dataMain
                if (req.jsExtRegExp.test(mainScript)) {
                    mainScript = dataMain;
                }

                //Put the data-main script in the files to load.
                cfg.deps = cfg.deps ? cfg.deps.concat(mainScript) : [mainScript];

                return true;
            }
        });
    }

    /**
     * The function that handles definitions of modules. Differs from
     * require() in that a string for the module should be the first argument,
     * and the function to execute after dependencies are loaded should
     * return a value to define the module corresponding to the first argument's
     * name.
     */
    define = function (name, deps, callback) {
        var node, context;

        //Allow for anonymous modules
        if (typeof name !== 'string') {
            //Adjust args appropriately
            callback = deps;
            deps = name;
            name = null;
        }

        //This module may not have dependencies
        if (!isArray(deps)) {
            callback = deps;
            deps = null;
        }

        //If no name, and callback is a function, then figure out if it a
        //CommonJS thing with dependencies.
        if (!deps && isFunction(callback)) {
            deps = [];
            //Remove comments from the callback string,
            //look for require calls, and pull them into the dependencies,
            //but only if there are function args.
            if (callback.length) {
                callback
                    .toString()
                    .replace(commentRegExp, '')
                    .replace(cjsRequireRegExp, function (match, dep) {
                        deps.push(dep);
                    });

                //May be a CommonJS thing even without require calls, but still
                //could use exports, and module. Avoid doing exports and module
                //work though if it just needs require.
                //REQUIRES the function to expect the CommonJS variables in the
                //order listed below.
                deps = (callback.length === 1 ? ['require'] : ['require', 'exports', 'module']).concat(deps);
            }
        }

        //If in IE 6-8 and hit an anonymous define() call, do the interactive
        //work.
        if (useInteractive) {
            node = currentlyAddingScript || getInteractiveScript();
            if (node) {
                if (!name) {
                    name = node.getAttribute('data-requiremodule');
                }
                context = contexts[node.getAttribute('data-requirecontext')];
            }
        }

        //Always save off evaluating the def call until the script onload handler.
        //This allows multiple modules to be in a file without prematurely
        //tracing dependencies, and allows for anonymous module support,
        //where the module name is not known until the script onload event
        //occurs. If no context, use the global queue, and get it processed
        //in the onscript load callback.
        (context ? context.defQueue : globalDefQueue).push([name, deps, callback]);
    };

    define.amd = {
        jQuery: true
    };


    /**
     * Executes the text. Normally just uses eval, but can be modified
     * to use a better, environment-specific call. Only used for transpiling
     * loader plugins, not for plain JS modules.
     * @param {String} text the text to execute/evaluate.
     */
    req.exec = function (text) {
        /*jslint evil: true */
        return eval(text);
    };

    //Set up with config info.
    req(cfg);
}(this));

/*!
 * FPSMeter 0.3.1 - 9th May 2013
 * https://github.com/Darsain/fpsmeter
 *
 * Licensed under the MIT license.
 * http://opensource.org/licenses/MIT
 */
;(function (w, undefined) {
    'use strict';

    /**
     * Create a new element.
     *
     * @param  {String} name Element type name.
     *
     * @return {Element}
     */
    function newEl(name) {
        return document.createElement(name);
    }

    /**
     * Apply theme CSS properties to element.
     *
     * @param  {Element} element DOM element.
     * @param  {Object}  theme   Theme object.
     *
     * @return {Element}
     */
    function applyTheme(element, theme) {
        for (var name in theme) {
            try {
                element.style[name] = theme[name];
            } catch (e) {}
        }
        return element;
    }

    /**
     * Return type of the value.
     *
     * @param  {Mixed} value
     *
     * @return {String}
     */
    function type(value) {
        if (value == null) {
            return String(value);
        }

        if (typeof value === 'object' || typeof value === 'function') {
            return Object.prototype.toString.call(value).match(/\s([a-z]+)/i)[1].toLowerCase() || 'object';
        }

        return typeof value;
    }

    /**
     * Check whether the value is in an array.
     *
     * @param  {Mixed} value
     * @param  {Array} array
     *
     * @return {Integer} Array index or -1 when not found.
     */
    function inArray(value, array) {
        if (type(array) !== 'array') {
            return -1;
        }
        if (array.indexOf) {
            return array.indexOf(value);
        }
        for (var i = 0, l = array.length; i < l; i++) {
            if (array[i] === value) {
                return i;
            }
        }
        return -1;
    }

    /**
     * Poor man's deep object extend.
     *
     * Example:
     *   extend({}, defaults, options);
     *
     * @return {Void}
     */
    function extend() {
        var args = arguments;
        for (var key in args[1]) {
            if (args[1].hasOwnProperty(key)) {
                switch (type(args[1][key])) {
                    case 'object':
                        args[0][key] = extend({}, args[0][key], args[1][key]);
                        break;

                    case 'array':
                        args[0][key] = args[1][key].slice(0);
                        break;

                    default:
                        args[0][key] = args[1][key];
                }
            }
        }
        return args.length > 2 ?
            extend.apply(null, [args[0]].concat(Array.prototype.slice.call(args, 2))) :
            args[0];
    }

    /**
     * Convert HSL color to HEX string.
     *
     * @param  {Array} hsl Array with [hue, saturation, lightness].
     *
     * @return {Array} Array with [red, green, blue].
     */
    function hslToHex(h, s, l) {
        var r, g, b;
        var v, min, sv, sextant, fract, vsf;

        if (l <= 0.5) {
            v = l * (1 + s);
        } else {
            v = l + s - l * s;
        }

        if (v === 0) {
            return '#000';
        } else {
            min = 2 * l - v;
            sv = (v - min) / v;
            h = 6 * h;
            sextant = Math.floor(h);
            fract = h - sextant;
            vsf = v * sv * fract;
            if (sextant === 0 || sextant === 6) {
                r = v;
                g = min + vsf;
                b = min;
            } else if (sextant === 1) {
                r = v - vsf;
                g = v;
                b = min;
            } else if (sextant === 2) {
                r = min;
                g = v;
                b = min + vsf;
            } else if (sextant === 3) {
                r = min;
                g = v - vsf;
                b = v;
            } else if (sextant === 4) {
                r = min + vsf;
                g = min;
                b = v;
            } else {
                r = v;
                g = min;
                b = v - vsf;
            }
            return '#' + componentToHex(r) + componentToHex(g) + componentToHex(b);
        }
    }

    /**
     * Helper function for hslToHex.
     */
    function componentToHex(c) {
        c = Math.round(c * 255).toString(16);
        return c.length === 1 ? '0' + c : c;
    }

    /**
     * Manage element event listeners.
     *
     * @param  {Node}     element
     * @param  {Event}    eventName
     * @param  {Function} handler
     * @param  {Bool}     remove
     *
     * @return {Void}
     */
    function listener(element, eventName, handler, remove) {
        if (element.addEventListener) {
            element[remove ? 'removeEventListener' : 'addEventListener'](eventName, handler, false);
        } else if (element.attachEvent) {
            element[remove ? 'detachEvent' : 'attachEvent']('on' + eventName, handler);
        }
    }

    // Preferred timing funtion
    var getTime;
    (function () {
        var perf = w.performance;
        if (perf && (perf.now || perf.webkitNow)) {
            var perfNow = perf.now ? 'now' : 'webkitNow';
            getTime = perf[perfNow].bind(perf);
        } else {
            getTime = function () {
                return +new Date();
            };
        }
    }());

    // Local WindowAnimationTiming interface polyfill
    var cAF = w.cancelAnimationFrame || w.cancelRequestAnimationFrame;
    var rAF = w.requestAnimationFrame;
    (function () {
        var vendors = ['moz', 'webkit', 'o'];
        var lastTime = 0;

        // For a more accurate WindowAnimationTiming interface implementation, ditch the native
        // requestAnimationFrame when cancelAnimationFrame is not present (older versions of Firefox)
        for (var i = 0, l = vendors.length; i < l && !cAF; ++i) {
            cAF = w[vendors[i]+'CancelAnimationFrame'] || w[vendors[i]+'CancelRequestAnimationFrame'];
            rAF = cAF && w[vendors[i]+'RequestAnimationFrame'];
        }

        if (!cAF) {
            rAF = function (callback) {
                var currTime = getTime();
                var timeToCall = Math.max(0, 16 - (currTime - lastTime));
                lastTime = currTime + timeToCall;
                return w.setTimeout(function () { callback(currTime + timeToCall); }, timeToCall);
            };

            cAF = function (id) {
                clearTimeout(id);
            };
        }
    }());

    // Property name for assigning element text content
    var textProp = type(document.createElement('div').textContent) === 'string' ? 'textContent' : 'innerText';

    /**
     * FPSMeter class.
     *
     * @param {Element} anchor  Element to append the meter to. Default is document.body.
     * @param {Object}  options Object with options.
     */
    function FPSMeter(anchor, options) {
        // Optional arguments
        if (type(anchor) === 'object' && anchor.nodeType === undefined) {
            options = anchor;
            anchor = document.body;
        }
        if (!anchor) {
            anchor = document.body;
        }

        // Private properties
        var self = this;
        var o = extend({}, FPSMeter.defaults, options || {});

        var el = {};
        var cols = [];
        var theme, heatmaps;
        var heatDepth = 100;
        var heating = [];

        var thisFrameTime = 0;
        var frameTime = o.threshold;
        var frameStart = 0;
        var lastLoop = getTime() - frameTime;
        var time;

        var fpsHistory = [];
        var durationHistory = [];

        var frameID, renderID;
        var showFps = o.show === 'fps';
        var graphHeight, count, i, j;

        // Exposed properties
        self.options = o;
        self.fps = 0;
        self.duration = 0;
        self.isPaused = 0;

        /**
         * Tick start for measuring the actual rendering duration.
         *
         * @return {Void}
         */
        self.tickStart = function () {
            frameStart = getTime();
        };

        /**
         * FPS tick.
         *
         * @return {Void}
         */
        self.tick = function () {
            time = getTime();
            thisFrameTime = time - lastLoop;
            frameTime += (thisFrameTime - frameTime) / o.smoothing;
            self.fps = 1000 / frameTime;
            self.duration = frameStart < lastLoop ? frameTime : time - frameStart;
            lastLoop = time;
        };

        /**
         * Pause display rendering.
         *
         * @return {Object} FPSMeter instance.
         */
        self.pause = function () {
            if (frameID) {
                self.isPaused = 1;
                clearTimeout(frameID);
                cAF(frameID);
                cAF(renderID);
                frameID = renderID = 0;
            }
            return self;
        };

        /**
         * Resume display rendering.
         *
         * @return {Object} FPSMeter instance.
         */
        self.resume = function () {
            if (!frameID) {
                self.isPaused = 0;
                requestRender();
            }
            return self;
        };

        /**
         * Update options.
         *
         * @param {String} name  Option name.
         * @param {Mixed}  value New value.
         *
         * @return {Object} FPSMeter instance.
         */
        self.set = function (name, value) {
            o[name] = value;
            showFps = o.show === 'fps';

            // Rebuild or reposition elements when specific option has been updated
            if (inArray(name, rebuilders) !== -1) {
                createMeter();
            }
            if (inArray(name, repositioners) !== -1) {
                positionMeter();
            }
            return self;
        };

        /**
         * Change meter into rendering duration mode.
         *
         * @return {Object} FPSMeter instance.
         */
        self.showDuration = function () {
            self.set('show', 'ms');
            return self;
        };

        /**
         * Change meter into FPS mode.
         *
         * @return {Object} FPSMeter instance.
         */
        self.showFps = function () {
            self.set('show', 'fps');
            return self;
        };

        /**
         * Toggles between show: 'fps' and show: 'duration'.
         *
         * @return {Object} FPSMeter instance.
         */
        self.toggle = function () {
            self.set('show', showFps ? 'ms' : 'fps');
            return self;
        };

        /**
         * Hide the FPSMeter. Also pauses the rendering.
         *
         * @return {Object} FPSMeter instance.
         */
        self.hide = function () {
            self.pause();
            el.container.style.display = 'none';
            return self;
        };

        /**
         * Show the FPSMeter. Also resumes the rendering.
         *
         * @return {Object} FPSMeter instance.
         */
        self.show = function () {
            self.resume();
            el.container.style.display = 'block';
            return self;
        };

        /**
         * Check the current FPS and save it in history.
         *
         * @return {Void}
         */
        function historyTick() {
            for (i = o.history; i--;) {
                fpsHistory[i] = i === 0 ? self.fps : fpsHistory[i-1];
                durationHistory[i] = i === 0 ? self.duration : durationHistory[i-1];
            }
        }

        /**
         * Returns heat hex color based on values passed.
         *
         * @param  {Integer} heatmap
         * @param  {Integer} value
         * @param  {Integer} min
         * @param  {Integer} max
         *
         * @return {Integer}
         */
        function getHeat(heatmap, value, min, max) {
            return heatmaps[0|heatmap][Math.round(Math.min((value - min) / (max - min) * heatDepth, heatDepth))];
        }

        /**
         * Update counter number and legend.
         *
         * @return {Void}
         */
        function updateCounter() {
            // Update legend only when changed
            if (el.legend.fps !== showFps) {
                el.legend.fps = showFps;
                el.legend[textProp] = showFps ? 'FPS' : 'ms';
            }
            // Update counter with a nicely formated & readable number
            count = showFps ? self.fps : self.duration;
            el.count[textProp] = count > 999 ? '999+' : count.toFixed(count > 99 ? 0 : o.decimals);
        }

        /**
         * Render current FPS state.
         *
         * @return {Void}
         */
        function render() {
            time = getTime();
            // If renderer stopped reporting, do a simulated drop to 0 fps
            if (lastLoop < time - o.threshold) {
                self.fps -= self.fps / Math.max(1, o.smoothing * 60 / o.interval);
                self.duration = 1000 / self.fps;
            }

            historyTick();
            updateCounter();

            // Apply heat to elements
            if (o.heat) {
                if (heating.length) {
                    for (i = heating.length; i--;) {
                        heating[i].el.style[theme[heating[i].name].heatOn] = showFps ?
                            getHeat(theme[heating[i].name].heatmap, self.fps, 0, o.maxFps) :
                            getHeat(theme[heating[i].name].heatmap, self.duration, o.threshold, 0);
                    }
                }

                if (el.graph && theme.column.heatOn) {
                    for (i = cols.length; i--;) {
                        cols[i].style[theme.column.heatOn] = showFps ?
                            getHeat(theme.column.heatmap, fpsHistory[i], 0, o.maxFps) :
                            getHeat(theme.column.heatmap, durationHistory[i], o.threshold, 0);
                    }
                }
            }

            // Update graph columns height
            if (el.graph) {
                for (j = 0; j < o.history; j++) {
                    cols[j].style.height = (showFps ?
                        (fpsHistory[j] ? Math.round(graphHeight / o.maxFps * Math.min(fpsHistory[j], o.maxFps)) : 0) :
                        (durationHistory[j] ? Math.round(graphHeight / o.threshold * Math.min(durationHistory[j], o.threshold)) : 0)
                    ) + 'px';
                }
            }
        }

        /**
         * Request rendering loop.
         *
         * @return {Int} Animation frame index.
         */
        function requestRender() {
            if (o.interval < 20) {
                frameID = rAF(requestRender);
                render();
            } else {
                frameID = setTimeout(requestRender, o.interval);
                renderID = rAF(render);
            }
        }

        /**
         * Meter events handler.
         *
         * @return {Void}
         */
        function eventHandler(event) {
            event = event || window.event;
            if (event.preventDefault) {
                event.preventDefault();
                event.stopPropagation();
            } else {
                event.returnValue = false;
                event.cancelBubble = true;
            }
            self.toggle();
        }

        /**
         * Destroys the current FPSMeter instance.
         *
         * @return {Void}
         */
        self.destroy = function () {
            // Stop rendering
            self.pause();
            // Remove elements
            removeMeter();
            // Stop listening
            self.tick = self.tickStart = function () {};
        };

        /**
         * Remove meter element.
         *
         * @return {Void}
         */
        function removeMeter() {
            // Unbind listeners
            if (o.toggleOn) {
                listener(el.container, o.toggleOn, eventHandler, 1);
            }
            // Detach element
            anchor.removeChild(el.container);
        }

        /**
         * Sets the theme, and generates heatmaps when needed.
         */
        function setTheme() {
            theme = FPSMeter.theme[o.theme];

            // Generate heatmaps
            heatmaps = theme.compiledHeatmaps || [];
            if (!heatmaps.length && theme.heatmaps.length) {
                for (j = 0; j < theme.heatmaps.length; j++) {
                    heatmaps[j] = [];
                    for (i = 0; i <= heatDepth; i++) {
                        heatmaps[j][i] = hslToHex(0.33 / heatDepth * i, theme.heatmaps[j].saturation, theme.heatmaps[j].lightness);
                    }
                }
                theme.compiledHeatmaps = heatmaps;
            }
        }

        /**
         * Creates and attaches the meter element.
         *
         * @return {Void}
         */
        function createMeter() {
            // Remove old meter if present
            if (el.container) {
                removeMeter();
            }

            // Set theme
            setTheme();

            // Create elements
            el.container = applyTheme(newEl('div'), theme.container);
            el.count = el.container.appendChild(applyTheme(newEl('div'), theme.count));
            el.legend = el.container.appendChild(applyTheme(newEl('div'), theme.legend));
            el.graph = o.graph ? el.container.appendChild(applyTheme(newEl('div'), theme.graph)) : 0;

            // Add elements to heating array
            heating.length = 0;
            for (var key in el) {
                if (el[key] && theme[key].heatOn) {
                    heating.push({
                        name: key,
                        el: el[key]
                    });
                }
            }

            // Graph
            cols.length = 0;
            if (el.graph) {
                // Create graph
                el.graph.style.width = (o.history * theme.column.width + (o.history - 1) * theme.column.spacing) + 'px';

                // Add columns
                for (i = 0; i < o.history; i++) {
                    cols[i] = el.graph.appendChild(applyTheme(newEl('div'), theme.column));
                    cols[i].style.position = 'absolute';
                    cols[i].style.bottom = 0;
                    cols[i].style.right = (i * theme.column.width + i * theme.column.spacing) + 'px';
                    cols[i].style.width = theme.column.width + 'px';
                    cols[i].style.height = '0px';
                }
            }

            // Set the initial state
            positionMeter();
            updateCounter();

            // Append container to anchor
            anchor.appendChild(el.container);

            // Retrieve graph height after it was appended to DOM
            if (el.graph) {
                graphHeight = el.graph.clientHeight;
            }

            // Add event listeners
            if (o.toggleOn) {
                if (o.toggleOn === 'click') {
                    el.container.style.cursor = 'pointer';
                }
                listener(el.container, o.toggleOn, eventHandler);
            }
        }

        /**
         * Positions the meter based on options.
         *
         * @return {Void}
         */
        function positionMeter() {
            applyTheme(el.container, o);
        }

        /**
         * Construct.
         */
        (function () {
            // Create meter element
            createMeter();
            // Start rendering
            requestRender();
        }());
    }

    // Expose the extend function
    FPSMeter.extend = extend;

    // Expose the FPSMeter class
    window.FPSMeter = FPSMeter;

    // Default options
    FPSMeter.defaults = {
        interval:  100,     // Update interval in milliseconds.
        smoothing: 10,      // Spike smoothing strength. 1 means no smoothing.
        show:      'fps',   // Whether to show 'fps', or 'ms' = frame duration in milliseconds.
        toggleOn:  'click', // Toggle between show 'fps' and 'ms' on this event.
        decimals:  1,       // Number of decimals in FPS number. 1 = 59.9, 2 = 59.94, ...
        maxFps:    60,      // Max expected FPS value.
        threshold: 100,     // Minimal tick reporting interval in milliseconds.

        // Meter position
        position: 'absolute', // Meter position.
        zIndex:   10,         // Meter Z index.
        left:     '5px',      // Meter left offset.
        top:      '5px',      // Meter top offset.
        right:    'auto',     // Meter right offset.
        bottom:   'auto',     // Meter bottom offset.
        margin:   '0 0 0 0',  // Meter margin. Helps with centering the counter when left: 50%;

        // Theme
        theme: 'dark', // Meter theme. Build in: 'dark', 'light', 'transparent', 'colorful'.
        heat:  0,      // Allow themes to use coloring by FPS heat. 0 FPS = red, maxFps = green.

        // Graph
        graph:   0, // Whether to show history graph.
        history: 20 // How many history states to show in a graph.
    };

    // Option names that trigger FPSMeter rebuild or reposition when modified
    var rebuilders = [
        'toggleOn',
        'theme',
        'heat',
        'graph',
        'history'
    ];
    var repositioners = [
        'position',
        'zIndex',
        'left',
        'top',
        'right',
        'bottom',
        'margin'
    ];
}(window));
;(function (w, FPSMeter, undefined) {
    'use strict';

    // Themes object
    FPSMeter.theme = {};

    // Base theme with layout, no colors
    var base = FPSMeter.theme.base = {
        heatmaps: [],
        container: {
            // Settings
            heatOn: null,
            heatmap: null,

            // Styles
            padding: '5px',
            minWidth: '95px',
            height: '30px',
            lineHeight: '30px',
            textAlign: 'right',
            textShadow: 'none'
        },
        count: {
            // Settings
            heatOn: null,
            heatmap: null,

            // Styles
            position: 'absolute',
            top: 0,
            right: 0,
            padding: '5px 10px',
            height: '30px',
            fontSize: '24px',
            fontFamily: 'Consolas, Andale Mono, monospace',
            zIndex: 2
        },
        legend: {
            // Settings
            heatOn: null,
            heatmap: null,

            // Styles
            position: 'absolute',
            top: 0,
            left: 0,
            padding: '5px 10px',
            height: '30px',
            fontSize: '12px',
            lineHeight: '32px',
            fontFamily: 'sans-serif',
            textAlign: 'left',
            zIndex: 2
        },
        graph: {
            // Settings
            heatOn: null,
            heatmap: null,

            // Styles
            position: 'relative',
            boxSizing: 'padding-box',
            MozBoxSizing: 'padding-box',
            height: '100%',
            zIndex: 1
        },
        column: {
            // Settings
            width: 4,
            spacing: 1,
            heatOn: null,
            heatmap: null
        }
    };

    // Dark theme
    FPSMeter.theme.dark = FPSMeter.extend({}, base, {
        heatmaps: [{
            saturation: 0.8,
            lightness: 0.8
        }],
        container: {
            background: '#222',
            color: '#fff',
            border: '1px solid #1a1a1a',
            textShadow: '1px 1px 0 #222'
        },
        count: {
            heatOn: 'color'
        },
        column: {
            background: '#3f3f3f'
        }
    });

    // Light theme
    FPSMeter.theme.light = FPSMeter.extend({}, base, {
        heatmaps: [{
            saturation: 0.5,
            lightness: 0.5
        }],
        container: {
            color: '#666',
            background: '#fff',
            textShadow: '1px 1px 0 rgba(255,255,255,.5), -1px -1px 0 rgba(255,255,255,.5)',
            boxShadow: '0 0 0 1px rgba(0,0,0,.1)'
        },
        count: {
            heatOn: 'color'
        },
        column: {
            background: '#eaeaea'
        }
    });

    // Colorful theme
    FPSMeter.theme.colorful = FPSMeter.extend({}, base, {
        heatmaps: [{
            saturation: 0.5,
            lightness: 0.6
        }],
        container: {
            heatOn: 'backgroundColor',
            background: '#888',
            color: '#fff',
            textShadow: '1px 1px 0 rgba(0,0,0,.2)',
            boxShadow: '0 0 0 1px rgba(0,0,0,.1)'
        },
        column: {
            background: '#777',
            backgroundColor: 'rgba(0,0,0,.2)'
        }
    });

    // Transparent theme
    FPSMeter.theme.transparent = FPSMeter.extend({}, base, {
        heatmaps: [{
            saturation: 0.8,
            lightness: 0.5
        }],
        container: {
            padding: 0,
            color: '#fff',
            textShadow: '1px 1px 0 rgba(0,0,0,.5)'
        },
        count: {
            padding: '0 5px',
            height: '40px',
            lineHeight: '40px'
        },
        legend: {
            padding: '0 5px',
            height: '40px',
            lineHeight: '42px'
        },
        graph: {
            height: '40px'
        },
        column: {
            width: 5,
            background: '#999',
            heatOn: 'backgroundColor',
            opacity: 0.5
        }
    });
}(window, FPSMeter));
/**
 *  Main entry point for Bento engine
 *  Defines global bento namespace, use bento.require and define
 *  @name bento
 */
(function () {
    'use strict';
    var bento = {
        require: window.require,
        define: window.define
    };
    window.bento = window.bento || bento;
}());
/**
 * Bento module, main entry point to game modules and managers
 * <br>Exports: Object
 * @module bento
 */
define('bento', [
    'bento/utils',
    'bento/lib/domready',
    'bento/managers/asset',
    'bento/managers/input',
    'bento/managers/object',
    'bento/managers/audio',
    'bento/managers/screen',
    'bento/managers/savestate',
    'bento/math/vector2',
    'bento/math/rectangle',
    'bento/renderer'
], function (
    Utils,
    DomReady,
    AssetManager,
    InputManager,
    ObjectManager,
    AudioManager,
    ScreenManager,
    SaveState,
    Vector2,
    Rectangle,
    Renderer
) {
    'use strict';
    var lastTime = new Date().getTime(),
        cumulativeTime = 1000 / 60,
        canvas,
        context,
        renderer,
        styleScaling = true,
        canvasRatio = 0,
        windowRatio,
        manualResize = false,
        canvasScale = {
            x: 1,
            y: 1
        },
        debug = {
            debugBar: null,
            fps: 0,
            fpsAccumulator: 0,
            fpsTicks: 0,
            fpsMaxAverage: 600,
            avg: 0,
            lastTime: 0
        },
        gameData = {},
        viewport = Rectangle(0, 0, 640, 480),
        setupDebug = function () {
            if (Utils.isCocoonJS()) {
                return;
            }
            debug.debugBar = document.createElement('div');
            debug.debugBar.style['font-family'] = 'Arial';
            debug.debugBar.style.padding = '8px';
            debug.debugBar.style.position = 'absolute';
            debug.debugBar.style.right = '0px';
            debug.debugBar.style.top = '0px';
            debug.debugBar.style.color = 'white';
            debug.debugBar.innerHTML = 'fps: 0';
            document.body.appendChild(debug.debugBar);
        },
        setupCanvas = function (settings, callback) {
            var parent;
            canvas = document.getElementById(settings.canvasId);

            if (!canvas) {
                // no canvas, create it
                parent = document.getElementById('wrapper');
                if (!parent) {
                    // just append it to the document body
                    parent = document.body;
                }
                canvas = document.createElement(Utils.isCocoonJS() ? 'screencanvas' : 'canvas');
                canvas.id = settings.canvasId;
                parent.appendChild(canvas);
            }
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            canvasRatio = viewport.height / viewport.width;

            settings.renderer = settings.renderer || 'auto';

            if (settings.renderer === 'auto') {
                settings.renderer = 'webgl';
                // canvas is accelerated in cocoonJS
                // should also use canvas for android
                if (Utils.isCocoonJS() || Utils.isAndroid()) {
                    settings.renderer = 'canvas2d';
                }
            }
            // setup renderer
            Renderer(settings.renderer, canvas, settings, function (rend) {
                renderer = rend;
                gameData = {
                    canvas: canvas,
                    renderer: rend,
                    canvasScale: canvasScale,
                    viewport: viewport,
                    entity: null
                };
                callback();
            });

        },
        onResize = function () {
            var width,
                height,
                innerWidth = window.innerWidth,
                innerHeight = window.innerHeight;

            if (manualResize) {
                return;
            }

            windowRatio = innerHeight / innerWidth;
            // resize to fill screen
            if (windowRatio < canvasRatio) {
                width = innerHeight / canvasRatio;
                height = innerHeight;
            } else {
                width = innerWidth;
                height = innerWidth * canvasRatio;
            }
            if (styleScaling) {
                canvas.style.width = width + 'px';
                canvas.style.height = height + 'px';
            } else {
                canvas.width = width;
                canvas.height = height;
            }
            canvasScale.x = width / viewport.width;
            canvasScale.y = height / viewport.height;
        },
        module = {
            /**
             * Setup game. Initializes Bento managers.
             * @name setup
             * @function
             * @instance
             * @param {Object} settings - settings for the game
             * @param {Object} settings.assetGroups - Asset groups to load. Key: group name, value: path to json file
             * @see AssetGroup
             * @param {Rectangle} settings.canvasDimension - base resolution for the game
             * @param {Boolean} settings.manualResize - Whether Bento should resize the canvas to fill automatically
             * @param {Function} callback - Called when game is loaded (not implemented yet)
             */
            setup: function (settings, callback) {
                DomReady(function () {
                    var runGame = function () {
                        module.objects.run();
                        if (callback) {
                            callback();
                        }
                    };
                    if (settings.canvasDimension) {
                        if (settings.canvasDimension.isRectangle) {
                            viewport = settings.canvasDimension || viewport;
                        } else {
                            throw 'settings.canvasDimension must be a rectangle';
                        }
                    }
                    setupCanvas(settings, function () {
                        // window resize listeners
                        manualResize = settings.manualResize;
                        window.addEventListener('resize', onResize, false);
                        window.addEventListener('orientationchange', onResize, false);
                        onResize();

                        module.input = InputManager(gameData);
                        module.objects = ObjectManager(gameData, settings);
                        module.assets = AssetManager();
                        module.audio = AudioManager(module);
                        module.screens = ScreenManager();

                        // mix functions
                        Utils.extend(module, module.objects);

                        if (settings.assetGroups) {
                            module.assets.loadAssetGroups(settings.assetGroups, runGame);
                        } else {
                            runGame();
                        }

                    });
                });
            },
            /**
             * Returns the current viewport (reference).
             * The viewport is a Rectangle.
             * viewport.x and viewport.y indicate its current position in the world (upper left corner)
             * viewport.width and viewport.height can be used to determine the size of the canvas
             * @function
             * @instance
             * @returns Rectangle
             * @name getViewport
             */
            getViewport: function () {
                return viewport;
            },
            /**
             * Returns the canvas element
             * @function
             * @instance
             * @returns HTML Canvas Element
             * @name getCanvas
             */
            getCanvas: function () {
                return canvas;
            },
            /**
             * Returns the current renderer engine
             * @function
             * @instance
             * @returns Renderer
             * @name getRenderer
             */
            getRenderer: function () {
                return renderer;
            },
            /**
             * Returns a gameData object
             * A gameData object is passed through every object during the update and draw
             * and contains all necessary information to render
             * @function
             * @instance
             * @returns {Object} data
             * @returns {HTMLCanvas} data.canvas - Reference to the current canvas element
             * @returns {Renderer} data.renderer - Reference to current Renderer
             * @returns {Vector2} data.canvasScale - Reference to current canvas scale
             * @returns {Rectangle} data.viewport - Reference to viewport object
             * @returns {Entity} data.entity - The current entity passing the data object (injected by Entity objects)
             * @name getGameData
             */
            getGameData: function () {
                return {
                    canvas: canvas,
                    renderer: renderer,
                    canvasScale: canvasScale,
                    viewport: viewport,
                    entity: null
                };
            },
            assets: null,
            objects: null,
            input: null,
            audio: null,
            screens: null,
            saveState: SaveState,
            utils: Utils
        };
    return module;
});
/**
 * Returns a color array, for use in renderer
 * <br>Exports: Function
 * @param {Number} r - Red value [0...255]
 * @param {Number} g - Green value [0...255]
 * @param {Number} b - Blue value [0...255]
 * @param {Number} a - Alpha value [0...1]
 * @returns {Array} Returns a color array
 * @module bento/color
 */
bento.define('bento/color', ['bento/utils'], function (Utils) {
    return function (r, g, b, a) {
        r = r / 255;
        r = g / 255;
        r = b / 255;
        if (!Utils.isDefined(a)) {
            a = 1;
        }
        return [r, g, b, a];
    };
});
/**
 * A base object to hold components
 * <br>Exports: Function
 * @module {Entity} bento/entity
 * @param {Object} settings - settings (all properties are optional)
 * @param {Function} settings.init - Called when entity is initialized 
 * @param {Function} settings.onCollide - Called when object collides in HSHG
 * @param {Array} settings.components - Array of component module functions 
 * @param {Array} settings.family - Array of family names 
 * @param {Vector2} settings.position - Vector2 of position to set 
 * @param {Vector2} settings.origin - Vector2 of origin to set 
 * @param {Vector2} settings.originRelative - Vector2 of relative origin to set 
 * @param {Boolean} settings.z - z-index to set 
 * @param {Boolean} settings.updateWhenPaused - Should entity keep updating when game is paused 
 * @param {Boolean} settings.global - Should entity remain after hiding a screen 
 * @param {Boolean} settings.float - Should entity move with the screen
 * @param {Boolean} settings.useHshg - Should entity use HSHG for collisions
 * @param {Boolean} settings.staticHshg - Is entity a static object in HSHG (doesn't check collisions on others, but can get checked on)
 * @returns {Entity} Returns a new entity object
 */
bento.define('bento/entity', [
    'bento',
    'bento/utils',
    'bento/math/vector2',
    'bento/math/rectangle'
], function (Bento, Utils, Vector2, Rectangle) {
    'use strict';
    var globalId = 0;
    return function (settings) {
        var i,
            name,
            visible = true,
            position = Vector2(0, 0),
            angle = 0,
            scale = Vector2(0, 0),
            origin = Vector2(0, 0),
            dimension = Rectangle(0, 0, 0, 0),
            rectangle,
            components = [],
            family = [],
            removedComponents = [],
            parent = null,
            uniqueId = ++globalId,
            cleanComponents = function () {
                /*var i, component;
                while (removedComponents.length) {
                    component = removedComponents.pop();
                    // should destroy be called?
                    if (component.destroy) {
                        component.destroy();
                    }
                    Utils.removeObject(components, component);
                }
                */

                // remove null components
                var i;
                for (i = components.length - 1; i >= 0; --i) {
                    if (!components[i]) {
                        components.splice(i, 1);
                    }
                }
            },
            entity = {
                /**
                 * z-index of an object
                 * @instance
                 * @default 0
                 * @name z
                 */
                z: 0,
                /**
                 * Timer value, incremented every update step
                 * @instance
                 * @default 0
                 * @name timer
                 */
                timer: 0,
                /**
                 * Indicates if an object should not be destroyed when a Screen ends
                 * @instance
                 * @default false
                 * @name global
                 */
                global: false,
                /**
                 * Indicates if an object should move with the scrolling of the screen
                 * @instance
                 * @default false
                 * @name float
                 */
                float: false,
                /**
                 * Indicates if an object should continue updating when the game is paused
                 * @instance
                 * @default false
                 * @name updateWhenPaused
                 */
                updateWhenPaused: false,
                /**
                 * Name of an object
                 * @instance
                 * @default ''
                 * @name name
                 */
                name: '',
                isAdded: false,
                /**
                 * Name of an object
                 * @instance
                 * @default ''
                 * @name useHshg
                 */
                useHshg: false,
                /**
                 * Calls start on every component
                 * @function
                 * @param {Object} data - gameData object
                 * @instance
                 * @name start
                 */
                start: function (data) {
                    var i,
                        l,
                        component;
                    if (data) {
                        data.entity = this;
                    }
                    // update components
                    for (i = 0, l = components.length; i < l; ++i) {
                        component = components[i];
                        if (component && component.start) {
                            component.start(data);
                        }
                    }
                },
                /**
                 * Calls destroy on every component
                 * @function
                 * @param {Object} data - gameData object
                 * @instance
                 * @name destroy
                 */
                destroy: function (data) {
                    var i,
                        l,
                        component;
                    if (data) {
                        data.entity = this;
                    }
                    // update components
                    for (i = 0, l = components.length; i < l; ++i) {
                        component = components[i];
                        if (component && component.destroy) {
                            component.destroy(data);
                        }
                    }
                },
                /**
                 * Calls update on every component
                 * @function
                 * @param {Object} data - gameData object
                 * @instance
                 * @name update
                 */
                update: function (data) {
                    var i,
                        l,
                        component;

                    if (data) {
                        data.entity = this;
                    }
                    // update components
                    for (i = 0, l = components.length; i < l; ++i) {
                        component = components[i];
                        if (component && component.update) {
                            component.update(data);
                        }
                    }
                    ++entity.timer;

                    // clean up
                    cleanComponents();
                },
                /**
                 * Calls draw on every component
                 * @function
                 * @param {Object} data - gameData object
                 * @instance
                 * @name draw
                 */
                draw: function (data) {
                    var i,
                        l,
                        component;
                    if (!visible) {
                        return;
                    }
                    if (data) {
                        data.entity = this;
                    }
                    // call components
                    for (i = 0, l = components.length; i < l; ++i) {
                        component = components[i];
                        if (component && component.draw) {
                            component.draw(data);
                        }
                    }
                    // post draw
                    for (i = components.length - 1; i >= 0; i--) {
                        component = components[i];
                        if (component && component.postDraw) {
                            component.postDraw(data);
                        }
                    }
                },
                /**
                 * Pushes string to its family array (Bento adds family members during the attach)
                 * @function
                 * @param {String} name - family name
                 * @instance
                 * @name addToFamily
                 */
                addToFamily: function (name) {
                    family.push(name);
                },
                /**
                 * Get family array
                 * @function
                 * @instance
                 * @name getFamily
                 */
                getFamily: function () {
                    return family;
                },
                /**
                 * Extends properties of entity
                 * @function
                 * @instance
                 * @param {Object} object - other object
                 * @see module:bento/utils#extend
                 * @name extend
                 */
                extend: function (object) {
                    return Utils.extend(entity, object);
                },
                /**
                 * Returns reference to entity position
                 * @function
                 * @instance
                 * @name getPosition
                 */
                getPosition: function () {
                    return position;
                },
                /**
                 * Sets entity position (copies vector values)
                 * @function
                 * @param {Vector2} vector - new position vector
                 * @instance
                 * @name setPosition
                 */
                setPosition: function (value) {
                    position.x = value.x;
                    position.y = value.y;
                },
                /**
                 * Sets entity x position
                 * @function
                 * @param {Number} x - new x position
                 * @instance
                 * @name setPositionX
                 */
                setPositionX: function (value) {
                    position.x = value;
                },
                /**
                 * Sets entity y position
                 * @function
                 * @param {Number} y - new x position
                 * @instance
                 * @name setPositionY
                 */
                setPositionY: function (value) {
                    position.y = value;
                },
                /**
                 * Returns reference to entity's size
                 * @function
                 * @returns {Rectangle} dimension - Reference to entity's size rectangle
                 * @instance
                 * @name getDimension
                 */
                getDimension: function () {
                    return dimension;
                },
                /**
                 * Sets entity's size
                 * @function
                 * @param {Rectangle} dimension - Reference to entity's size rectangle
                 * @instance
                 * @name getDimension
                 */
                setDimension: function (value) {
                    dimension = value;
                },
                /**
                 * Returns the bounding box of an entity. If no bounding box was set
                 * previously, the dimension is returned.
                 * @function
                 * @returns {Rectangle} boundingbox - Entity's boundingbox
                 * @instance
                 * @name getBoundingBox
                 */
                getBoundingBox: function () {
                    var scale, x1, x2, y1, y2, box;
                    if (!rectangle) {
                        // TODO get rid of scale component dependency
                        scale = entity.scale ? entity.scale.getScale() : Vector2(1, 1);
                        x1 = position.x - origin.x * scale.x;
                        y1 = position.y - origin.y * scale.y;
                        x2 = position.x + (dimension.width - origin.x) * scale.x;
                        y2 = position.y + (dimension.height - origin.y) * scale.y;
                        // swap variables if scale is negative
                        if (scale.x < 0) {
                            x2 = [x1, x1 = x2][0];
                        }
                        if (scale.y < 0) {
                            y2 = [y1, y1 = y2][0];
                        }
                        return Rectangle(x1, y1, x2 - x1, y2 - y1);
                    } else {
                        // TODO: cloning could be expensive for polygons
                        box = rectangle.clone();
                        scale = entity.scale ? entity.scale.getScale() : Vector2(1, 1);
                        box.x *= Math.abs(scale.x);
                        box.y *= Math.abs(scale.y);
                        box.width *= Math.abs(scale.x);
                        box.height *= Math.abs(scale.y);
                        box.x += position.x;
                        box.y += position.y;
                        return box;
                    }
                },
                /**
                 * Sets the entity's boundingbox
                 * @function
                 * @param {Rectangle} boundingbox - The entity's new bounding box
                 * @instance
                 * @name setBoundingBox
                 */
                setBoundingBox: function (value) {
                    rectangle = value;
                },
                /**
                 * Returns the bounding box of an entity. If no bounding box was set
                 * previously, undefined is returned.
                 * @function
                 * @returns {Rectangle} boundingbox - Entity's boundingbox
                 * @instance
                 * @name getRectangle
                 */
                getRectangle: function () {
                    return rectangle;
                },
                /**
                 * Sets the origin (center of rotation)
                 * @function
                 * @param {Vector2} origin - Position of the origin (relative to upper left corner of the dimension)
                 * @instance
                 * @name setOrigin
                 */
                setOrigin: function (value) {
                    origin.x = value.x;
                    origin.y = value.y;
                },
                /**
                 * Sets the origin relatively (0...1)
                 * @function
                 * @param {Vector2} origin - Position of the origin (relative to upper left corner of the dimension)
                 * @instance
                 * @name setOriginRelative
                 */
                setOriginRelative: function (value) {
                    origin.x = value.x * dimension.width;
                    origin.y = value.y * dimension.height;
                },
                /**
                 * Returns the origin (center of rotation)
                 * @function
                 * @returns {Vector2} origin - Entity's origin
                 * @instance
                 * @name getOrigin
                 */
                getOrigin: function () {
                    return origin;
                },
                /**
                 * Whether the entity is set to visible or not
                 * @function
                 * @returns {Boolean} visible - Visibility state
                 * @instance
                 * @name isVisible
                 */
                isVisible: function () {
                    return visible;
                },
                /**
                 * Sets the entity's visibility state
                 * @function
                 * @param {Boolean} visible - Visibility state
                 * @instance
                 * @name setVisible
                 */
                setVisible: function (value) {
                    visible = value;
                },
                /**
                 * Attaches a child object to the entity. Entities can form a scenegraph.
                 * Generally, entities act as nodes while components act like leaves.
                 * Note that start will be called in the child.
                 * @function
                 * @param {Object} node - The child object to attach
                 * @param {String} [name] - Name to expose in the entity. The child object can be reached by entity[name]
                 * @instance
                 * @name attach
                 */
                attach: function (component, name) {
                    var mixin = {},
                        parent = entity;
                    components.push(component);
                    if (component.setParent) {
                        component.setParent(entity);
                    }
                    if (component.init) {
                        component.init();
                    }
                    if (entity.isAdded) {
                        if (component.start) {
                            component.start();
                        }
                    } else {
                        if (parent.getParent) {
                            parent = parent.getParent();
                        }
                        while (parent) {
                            if (parent.isAdded) {
                                if (component.start) {
                                    component.start();
                                }
                            }
                            parent = parent.getParent();
                        }
                    }
                    if (name) {
                        mixin[name] = component;
                        Utils.extend(entity, mixin);
                    }
                    return entity;
                },
                /**
                 * Removes a child object from the entity. Note that destroy will be called in the child.
                 * @function
                 * @param {Object} node - The child object to remove
                 * @instance
                 * @name remove
                 */
                remove: function (component) {
                    var i, type, index;
                    if (!component) {
                        return;
                    }
                    index = components.indexOf(component);
                    if (index >= 0) {
                        if (component.destroy) {
                            component.destroy();
                        }
                        // TODO: clean component
                        components[index] = null;
                    }
                    return entity;
                },
                /**
                 * Returns the reference to the components array
                 * @function
                 * @instance
                 * @name getComponents
                 */
                getComponents: function () {
                    return components;
                },
                /**
                 * Returns the first child found with a certain name
                 * @function
                 * @instance
                 * @param {String} name - name of the component
                 * @name getComponentByName
                 */
                getComponentByName: function (name) {
                    var i, l, component;
                    for (i = 0, i = components.length; i < l; ++i) {
                        component = components[i];
                        if (component.name === name) {
                            return component;
                        }
                    }
                },
                /**
                 * Returns the index of a child
                 * @function
                 * @instance
                 * @param {Object} child - reference to the child
                 * @name getComponentIndex
                 */
                getComponentIndex: function (component) {
                    return components.indexOf(component);
                },
                /**
                 * Moves a child to a certain index in the array
                 * @function
                 * @instance
                 * @param {Object} child - reference to the child
                 * @param {Number} index - new index
                 * @name moveComponentTo
                 */
                moveComponentTo: function (component, newIndex) {
                    // note: currently dangerous to do during an update loop
                    var i, type, index;
                    if (!component) {
                        return;
                    }
                    index = components.indexOf(component);
                    if (index >= 0) {
                        // remove old
                        components.splice(index, 1);
                        // insert at new place
                        components.splice(newIndex, 0, component);
                    }
                },
                /**
                 * Assigns the parent
                 * @function
                 * @instance
                 * @param {Object} parent - reference to the parent object
                 * @name setParent
                 */
                setParent: function (obj) {
                    parent = obj;
                },
                /**
                 * Returns the reference to the parent object
                 * @function
                 * @instance
                 * @name getParent
                 */
                getParent: function () {
                    return parent;
                },
                /**
                 * Returns a unique entity ID number
                 * @function
                 * @instance
                 * @name getId
                 */
                getId: function () {
                    return uniqueId;
                },
                /**
                 * Callback when entities collide.
                 *
                 * @callback CollisionCallback
                 * @param {Entity} other - The other entity colliding
                 */
                /**
                 * Checks if entity is colliding with another entity
                 * @function
                 * @instance
                 * @param {Entity} other - The other entity
                 * @param {Vector2} [offset] - A position offset
                 * @param {CollisionCallback} [callback] - Called when entities are colliding
                 * @name collidesWith
                 */
                collidesWith: function (other, offset, callback) {
                    var intersect;
                    if (!Utils.isDefined(offset)) {
                        offset = Vector2(0, 0);
                    }
                    intersect = entity.getBoundingBox().offset(offset).intersect(other.getBoundingBox());
                    if (intersect && callback) {
                        callback(other);
                    }
                    return intersect;
                },
                /**
                 * Checks if entity is colliding with any entity in an array
                 * Returns the first entity it finds that collides with the entity.
                 * @function
                 * @instance
                 * @param {Array} other - Array of entities, ignores self if present
                 * @param {Vector2} [offset] - A position offset
                 * @param {CollisionCallback} [callback] - Called when entities are colliding
                 * @name collidesWithGroup
                 */
                collidesWithGroup: function (array, offset, callback) {
                    var i,
                        obj,
                        box;
                    if (!Utils.isDefined(offset)) {
                        offset = Vector2(0, 0);
                    }
                    if (!Utils.isArray(array)) {
                        // throw 'Collision check must be with an Array of object';
                        console.log('Collision check must be with an Array of object');
                        return;
                    }
                    if (!array.length) {
                        return null;
                    }
                    box = entity.getBoundingBox().offset(offset);
                    for (i = 0; i < array.length; ++i) {
                        obj = array[i];
                        if (obj === entity) {
                            continue;
                        }
                        if (obj.getBoundingBox && box.intersect(obj.getBoundingBox())) {
                            if (callback) {
                                callback(obj);
                            }
                            return obj;
                        }
                    }
                    return null;
                },
                getAABB: function () {
                    var box = entity.getBoundingBox();
                    return {
                        min: [box.x, box.y],
                        max: [box.x + box.width, box.y + box.height]
                    };
                }
            };

        // read settings
        if (settings) {
            if (settings.components) {
                if (!Utils.isArray(settings.components)) {
                    settings.components = [settings.components];
                }
                for (i = 0; i < settings.components.length; ++i) {
                    settings.components[i](entity, settings);
                }
            }
            if (settings.position) {
                entity.setPosition(settings.position);
            }
            if (settings.origin) {
                entity.setOrigin(settings.origin);
            }
            if (settings.originRelative) {
                entity.setOriginRelative(settings.originRelative);
            }
            if (settings.name) {
                entity.name = settings.name;
            }
            if (settings.family) {
                if (!Utils.isArray(settings.family)) {
                    settings.family = [settings.family];
                }
                for (i = 0; i < settings.family.length; ++i) {
                    entity.addToFamily(settings.family[i]);
                }
            }
            if (settings.init) {
                settings.init.apply(entity);
            }

            entity.z = settings.z || 0;
            entity.updateWhenPaused = settings.updateWhenPaused || false;
            entity.global = settings.global || false;
            entity.float = settings.float || false;
            entity.useHshg = settings.useHshg || false;
            entity.staticHshg = settings.staticHshg || false;
            entity.onCollide = settings.onCollide;

            if (settings.addNow) {
                Bento.objects.add(entity);
            }

        }
        return entity;
    };
});
/**
 * Sends custom events
 * <br>Exports: Object
 * @module bento/eventsystem
 */
bento.define('bento/eventsystem', [
    'bento/utils'
], function (Utils) {
    var events = {},
        /*events = {
            [String eventName]: [Array listeners]
        }*/
        removedEvents = [],
        cleanEventListeners = function () {
            var i, j, l, listeners, eventName, callback;
            for (j = 0; j < removedEvents.length; j += 1) {
                eventName = removedEvents[j].eventName;
                callback = removedEvents[j].callback;
                if (Utils.isUndefined(events[eventName])) {
                    continue;
                }
                listeners = events[eventName];
                for (i = listeners.length - 1; i >= 0; i -= 1) {
                    if (listeners[i] === callback) {
                        listeners.splice(i, 1);
                        break;
                    }
                }
            }
            removedEvents = [];
        },
        addEventListener = function (eventName, callback) {
            if (Utils.isUndefined(events[eventName])) {
                events[eventName] = [];
            }
            events[eventName].push(callback);
        },
        removeEventListener = function (eventName, callback) {
            removedEvents.push({
                eventName: eventName,
                callback: callback
            });
        };

    return {
        /**
         * Fires an event
         * @function
         * @instance
         * @param {String} eventName - Name of the event
         * @param {Object} [eventData] - Extra data to pass with event
         * @name fire
         */
        fire: function (eventName, eventData) {
            var i, l, listeners, listener;
            cleanEventListeners();
            if (!Utils.isString(eventName)) {
                eventName = eventName.toString();
            }
            if (Utils.isUndefined(events[eventName])) {
                return;
            }
            listeners = events[eventName];
            for (i = 0, l = listeners.length; i < l; ++i) {
                listener = listeners[i];
                if (listener) {
                    listener(eventData);
                } else {
                    // TODO: fix this
                    console.log('Warning: listener is not a function:', listener, i);
                }
            }
        },
        addEventListener: addEventListener,
        removeEventListener: removeEventListener,
        /**
         * Callback function
         *
         * @callback Callback
         * @param {Object} eventData - Any data that is passed 
         */
        /**
         * Listen to event
         * @function
         * @instance
         * @param {String} eventName - Name of the event
         * @param {Callback} callback - Callback function.
         * Be careful about adding anonymous functions here, you should consider removing the event listener
         * to prevent memory leaks.
         * @name on
         */
        on: addEventListener,
        /**
         * Removes event listener
         * @function
         * @instance
         * @param {String} eventName - Name of the event
         * @param {Callback} callback - Reference to the callback function
         * @name off
         */
        off: removeEventListener
    };
});
/**
 * A wrapper for module images, holds data for image atlas
 * <br>Exports: Function
 * @module bento/packedimage
 * @param {HTMLImageElement} image - HTML Image Element
 * @param {Rectangle} frame - Frame boundaries in the image
 * @returns {Rectangle} rectangle - Returns a rectangle with additional image property
 * @returns {HTMLImage} rectangle.image - Reference to the image 
 */
bento.define('bento/packedimage', [
    'bento/math/rectangle'
], function (Rectangle) {
    return function (image, frame) {
        var rectangle = frame ? Rectangle(frame.x, frame.y, frame.w, frame.h) :
            Rectangle(0, 0, image.width, image.height);
        rectangle.image = image;
        return rectangle;
    };
});
/**
 * Base functions for renderer. Has many equivalent functions to a canvas context.
 * <br>Exports: Function
 * @module bento/renderer
 */
bento.define('bento/renderer', [
    'bento/utils'
], function (Utils) {
    return function (type, canvas, settings, callback) {
        var module = {
            save: function () {},
            restore: function () {},
            translate: function () {},
            scale: function (x, y) {},
            rotate: function (angle) {},
            fillRect: function (color, x, y, w, h) {},
            fillCircle: function (color, x, y, radius) {},
            strokeRect: function (color, x, y, w, h) {},
            drawImage: function (spriteImage, sx, sy, sw, sh, x, y, w, h) {},
            begin: function () {},
            flush: function () {},
            setColor: function () {},
            getOpacity: function () {},
            setOpacity: function () {},
            createSurface: function () {},
            setContext: function () {},
            restoreContext: function () {}
        };
        require(['bento/renderers/' + type], function (renderer) {
            Utils.extend(module, renderer(canvas, settings));
            callback(module);
        });
    };
});
/**
 * A collection of useful functions
 * Export type: Object
 * @module bento/utils
 */
bento.define('bento/utils', [], function () {
    'use strict';
    var utils,
        isString = function (value) {
            return typeof value === 'string' || value instanceof String;
        },
        isArray = Array.prototype.isArray || function (value) {
            return Object.prototype.toString.call(value) === '[object Array]';
        },
        isObject = function (value) {
            return Object.prototype.toString.call(value) === '[object Object]';
        },
        isFunction = function (value) {
            return Object.prototype.toString.call(value) === '[object Function]';
        },
        isNumber = function (obj) {
            return Object.prototype.toString.call(obj) === '[object Number]';
        },
        isBoolean = function (obj) {
            return obj === true || obj === false ||
                Object.prototype.toString.call(obj) === '[object Boolean]';
        },
        isInt = function (obj) {
            return parseFloat(obj) === parseInt(obj, 10) && !isNaN(obj);
        },
        isUndefined = function (obj) {
            return obj === void(0);
        },
        isDefined = function (obj) {
            return obj !== void(0);
        },
        removeObject = function (array, obj) {
            var i,
                l;
            for (i = 0, l = array.length; i < l; i += 1) {
                if (array[i] === obj) {
                    array.splice(i, 1);
                    break;
                }
            }
        },
        extend = function (obj1, obj2, overwrite) {
            var prop, temp;
            for (prop in obj2) {
                if (obj2.hasOwnProperty(prop)) {
                    if (obj1.hasOwnProperty(prop) && !overwrite) {
                        // property already exists, move it up
                        obj1.base = obj1.base || {};
                        temp = {};
                        temp[prop] = obj1[prop];
                        extend(obj1.base, temp);
                    }
                    if (isObject(obj2[prop])) {
                        obj1[prop] = extend({}, obj2[prop]);
                    } else {
                        obj1[prop] = obj2[prop];
                    }
                }
            }
            return obj1;
        },
        getKeyLength = function (obj) {
            return Object.keys(obj).length;
        },
        setAnimationFrameTimeout = function (callback, timeout) {
            var now = new Date().getTime(),
                rafID = null;

            if (timeout === undefined) timeout = 1;

            function animationFrame() {
                var later = new Date().getTime();

                if (later - now >= timeout) {
                    callback();
                } else {
                    rafID = requestAnimationFrame(animationFrame);
                }
            }

            animationFrame();
            return {
                cancel: function () {
                    if (typeof cancelAnimationFrame !== 'undefined') {
                        cancelAnimationFrame(rafID);
                    }
                }
            };
        },
        stableSort = (function () {
            // https://github.com/Two-Screen/stable
            // A stable array sort, because `Array#sort()` is not guaranteed stable.
            // This is an implementation of merge sort, without recursion.
            var stable = function (arr, comp) {
                    return exec(arr.slice(), comp);
                },
                // Execute the sort using the input array and a second buffer as work space.
                // Returns one of those two, containing the final result.
                exec = function (arr, comp) {
                    if (typeof (comp) !== 'function') {
                        comp = function (a, b) {
                            return String(a).localeCompare(b);
                        };
                    }

                    // Short-circuit when there's nothing to sort.
                    var len = arr.length;
                    if (len <= 1) {
                        return arr;
                    }

                    // Rather than dividing input, simply iterate chunks of 1, 2, 4, 8, etc.
                    // Chunks are the size of the left or right hand in merge sort.
                    // Stop when the left-hand covers all of the array.
                    var buffer = new Array(len);
                    for (var chk = 1; chk < len; chk *= 2) {
                        pass(arr, comp, chk, buffer);

                        var tmp = arr;
                        arr = buffer;
                        buffer = tmp;
                    }
                    return arr;
                },
                // Run a single pass with the given chunk size.
                pass = function (arr, comp, chk, result) {
                    var len = arr.length;
                    var i = 0;
                    // Step size / double chunk size.
                    var dbl = chk * 2;
                    // Bounds of the left and right chunks.
                    var l, r, e;
                    // Iterators over the left and right chunk.
                    var li, ri;

                    // Iterate over pairs of chunks.
                    for (l = 0; l < len; l += dbl) {
                        r = l + chk;
                        e = r + chk;
                        if (r > len) r = len;
                        if (e > len) e = len;

                        // Iterate both chunks in parallel.
                        li = l;
                        ri = r;
                        while (true) {
                            // Compare the chunks.
                            if (li < r && ri < e) {
                                // This works for a regular `sort()` compatible comparator,
                                // but also for a simple comparator like: `a > b`
                                if (comp(arr[li], arr[ri]) <= 0) {
                                    result[i++] = arr[li++];
                                } else {
                                    result[i++] = arr[ri++];
                                }
                            }
                            // Nothing to compare, just flush what's left.
                            else if (li < r) {
                                result[i++] = arr[li++];
                            } else if (ri < e) {
                                result[i++] = arr[ri++];
                            }
                            // Both iterators are at the chunk ends.
                            else {
                                break;
                            }
                        }
                    }
                };
            stable.inplace = function (arr, comp) {
                var result = exec(arr, comp);

                // This simply copies back if the result isn't in the original array,
                // which happens on an odd number of passes.
                if (result !== arr) {
                    pass(result, null, arr.length, arr);
                }

                return arr;
            };
            // return it instead and keep the method local to this scope
            return stable;
        })(),
        keyboardMapping = (function () {
            var aI,
                keys = {
                    // http://github.com/RobertWhurst/KeyboardJS
                    // general
                    "3": ["cancel"],
                    "8": ["backspace"],
                    "9": ["tab"],
                    "12": ["clear"],
                    "13": ["enter"],
                    "16": ["shift"],
                    "17": ["ctrl"],
                    "18": ["alt", "menu"],
                    "19": ["pause", "break"],
                    "20": ["capslock"],
                    "27": ["escape", "esc"],
                    "32": ["space", "spacebar"],
                    "33": ["pageup"],
                    "34": ["pagedown"],
                    "35": ["end"],
                    "36": ["home"],
                    "37": ["left"],
                    "38": ["up"],
                    "39": ["right"],
                    "40": ["down"],
                    "41": ["select"],
                    "42": ["printscreen"],
                    "43": ["execute"],
                    "44": ["snapshot"],
                    "45": ["insert", "ins"],
                    "46": ["delete", "del"],
                    "47": ["help"],
                    "91": ["command", "windows", "win", "super", "leftcommand", "leftwindows", "leftwin", "leftsuper"],
                    "92": ["command", "windows", "win", "super", "rightcommand", "rightwindows", "rightwin", "rightsuper"],
                    "145": ["scrolllock", "scroll"],
                    "186": ["semicolon", ";"],
                    "187": ["equal", "equalsign", "="],
                    "188": ["comma", ","],
                    "189": ["dash", "-"],
                    "190": ["period", "."],
                    "191": ["slash", "forwardslash", "/"],
                    "192": ["graveaccent", "`"],
                    "219": ["openbracket", "["],
                    "220": ["backslash", "\\"],
                    "221": ["closebracket", "]"],
                    "222": ["apostrophe", "'"],

                    //0-9
                    "48": ["zero", "0"],
                    "49": ["one", "1"],
                    "50": ["two", "2"],
                    "51": ["three", "3"],
                    "52": ["four", "4"],
                    "53": ["five", "5"],
                    "54": ["six", "6"],
                    "55": ["seven", "7"],
                    "56": ["eight", "8"],
                    "57": ["nine", "9"],

                    //numpad
                    "96": ["numzero", "num0"],
                    "97": ["numone", "num1"],
                    "98": ["numtwo", "num2"],
                    "99": ["numthree", "num3"],
                    "100": ["numfour", "num4"],
                    "101": ["numfive", "num5"],
                    "102": ["numsix", "num6"],
                    "103": ["numseven", "num7"],
                    "104": ["numeight", "num8"],
                    "105": ["numnine", "num9"],
                    "106": ["nummultiply", "num*"],
                    "107": ["numadd", "num+"],
                    "108": ["numenter"],
                    "109": ["numsubtract", "num-"],
                    "110": ["numdecimal", "num."],
                    "111": ["numdivide", "num/"],
                    "144": ["numlock", "num"],

                    //function keys
                    "112": ["f1"],
                    "113": ["f2"],
                    "114": ["f3"],
                    "115": ["f4"],
                    "116": ["f5"],
                    "117": ["f6"],
                    "118": ["f7"],
                    "119": ["f8"],
                    "120": ["f9"],
                    "121": ["f10"],
                    "122": ["f11"],
                    "123": ["f12"]
                };
            for (aI = 65; aI <= 90; aI += 1) {
                keys[aI] = String.fromCharCode(aI + 32);
            }

            return keys;
        })();

    utils = {
        /**
         * @function
         * @instance
         * @name isString
         */
        isString: isString,
        /**
         * @function
         * @instance
         * @name isArray
         */
        isArray: isArray,
        /**
         * @function
         * @instance
         * @name isObject
         */
        isObject: isObject,
        /**
         * @function
         * @instance
         * @name isFunction
         */
        isFunction: isFunction,
        /**
         * @function
         * @instance
         * @name isNumber
         */
        isNumber: isNumber,
        /**
         * @function
         * @instance
         * @name isBoolean
         */
        isBoolean: isBoolean,
        /**
         * @function
         * @instance
         * @name isInt
         */
        isInt: isInt,
        /**
         * @function
         * @name isUndefined
         * @instance
         */
        isUndefined: isUndefined,
        /**
         * @function
         * @instance
         * @name isDefined
         */
        isDefined: isDefined,
        /**
         * Removes entry from array
         * @function
         * @instance
         * @param {Array} array - array
         * @param {Anything} value - any type
         * @return {Array} The updated array
         * @name removeObject
         */
        removeObject: removeObject,
        /**
         * Extends object literal properties with another object
         * If the objects have the same property name, then the old one is pushed to a property called "base"
         * @function
         * @instance
         * @name extend
         * @param {Object} object1 - original object
         * @param {Object} object2 - new object
         * @param {Bool} [overwrite] - Overwrites properties
         * @return {Array} The updated array
         */
        extend: extend,
        /**
         * Counts the number of keys in an object literal
         * @function
         * @instance
         * @name getKeyLength
         * @param {Object} object - object literal
         * @return {Number} Number of keys
         */
        getKeyLength: getKeyLength,
        stableSort: stableSort,
        keyboardMapping: keyboardMapping,
        /**
         * Returns a random number [0...n)
         * @function
         * @instance
         * @name getRandom
         * @param {Number} n - limit of random number
         * @return {Number} Randomized number
         */
        getRandom: function (n) {
            return Math.floor(Math.random() * n);
        },
        /**
         * Turns degrees into radians
         * @function
         * @instance
         * @name toRadian
         * @param {Number} degree - value in degrees
         * @return {Number} radians
         */
        toRadian: function (degree) {
            return degree * Math.PI / 180;
        },
        /**
         * Sign of  anumber
         * @function
         * @instance
         * @param {Number} value - value to check
         * @name sign
         */
        sign: function (value) {
            if (value > 0) {
                return 1;
            } else if (value < 0) {
                return -1;
            } else {
                return 0;
            }
        },
        /**
         * Steps towards a number without going over the limit
         * @function
         * @instance
         * @param {Number} start - current value
         * @param {Number} end - target value
         * @param {Number} step - step to take
         * @name approach
         */
        approach: function (start, end, max) {
            if (start < end) {
                return Math.min(start + max, end);
            } else {
                return Math.max(start - max, end);
            }
        },
        /**
         * Checks useragent if device is an apple device
         * @function
         * @instance
         * @name isApple
         */
        isApple: function () {
            var device = (navigator.userAgent).match(/iPhone|iPad|iPod/i);
            return /iPhone/i.test(device) || /iPad/i.test(device) || /iPod/i.test(device);
        },
        /**
         * Checks useragent if device is an android device
         * @function
         * @instance
         * @name isAndroid
         */
        isAndroid: function () {
            return /Android/i.test(navigator.userAgent);
        },
        /**
         * Checks if environment is cocoon
         * @function
         * @instance
         * @name isCocoonJS
         */
        isCocoonJS: function () {
            return navigator.isCocoonJS;
        }
    };
    return utils;
});
/**
 * Animation component. Draws an animated sprite on screen at the entity position.
 * <br>Exports: Function
 * @module bento/components/animation
 * @param {Entity} entity - The entity to attach the component to
 * @param {Object} settings - Settings
 * @returns Returns the entity passed. The entity will have the component attached.
 */
bento.define('bento/components/animation', [
    'bento',
    'bento/utils',
], function (Bento, Utils) {
    'use strict';
    return function (entity, settings) {
        var spriteImage,
            animationSettings,
            animations = {},
            currentAnimation,
            mixin = {},
            currentFrame = 0,
            frameCountX = 1,
            frameCountY = 1,
            frameWidth = 0,
            frameHeight = 0,
            onCompleteCallback,
            origin = entity.getOrigin(),
            component = {
                /**
                 * Name of the component
                 * @instance
                 * @default 'animation'
                 * @name name
                 */
                name: 'animation',
                /**
                 * Sets up animation
                 * @function
                 * @instance
                 * @param {Object} settings - Settings object
                 * @name setup
                 */
                setup: function (settings) {
                    if (settings) {
                        animationSettings = settings;
                    } else {
                        // create default animation
                        animationSettings = {
                            frameCountX: 1,
                            frameCountY: 1
                        };
                    }
                    // add default animation
                    if (!animationSettings.animations) {
                        animationSettings.animations = {};
                    }
                    if (!animationSettings.animations['default']) {
                        animationSettings.animations['default'] = {
                            frames: [0]
                        };
                    }
                    // get image
                    if (settings.image) {
                        spriteImage = settings.image;
                    } else if (settings.imageName) {
                        // load from string
                        if (Bento.assets) {
                            spriteImage = Bento.assets.getImage(settings.imageName);
                        } else {
                            throw 'Bento asset manager not loaded';
                        }
                    } else {
                        // no image specified
                        return;
                    }
                    // use frameWidth if specified (overrides frameCountX and frameCountY)
                    if (animationSettings.frameWidth) {
                        frameWidth = animationSettings.frameWidth;
                        frameCountX = Math.floor(spriteImage.width / frameWidth);
                    } else {
                        frameCountX = animationSettings.frameCountX || 1;
                        frameWidth = spriteImage.width / frameCountX;
                    }
                    if (animationSettings.frameHeight) {
                        frameHeight = animationSettings.frameHeight;
                        frameCountY = Math.floor(spriteImage.height / frameHeight);
                    } else {
                        frameCountY = animationSettings.frameCountY || 1;
                        frameHeight = spriteImage.height / frameCountY;
                    }
                    // set dimension of entity object
                    entity.getDimension().width = frameWidth;
                    entity.getDimension().height = frameHeight;
                    // set to default
                    animations = animationSettings.animations;
                    currentAnimation = animations['default'];
                },
                /**
                 * Set component to a different animation
                 * @function
                 * @instance
                 * @param {String} name - Name of the animation.
                 * @param {Function} callback - Called when animation ends.
                 * @param {Boolean} keepCurrentFrame - Prevents animation to jump back to frame 0
                 * @name setAnimation
                 */
                setAnimation: function (name, callback, keepCurrentFrame) {
                    var anim = animations[name];
                    if (!anim) {
                        console.log('Warning: animation ' + name + ' does not exist.');
                        return;
                    }
                    if (anim && currentAnimation !== anim) {
                        if (!Utils.isDefined(anim.loop)) {
                            anim.loop = true;
                        }
                        if (!Utils.isDefined(anim.backTo)) {
                            anim.backTo = 0;
                        }
                        // set even if there is no callback
                        onCompleteCallback = callback;
                        currentAnimation = anim;
                        currentAnimation.name = name;
                        if (!keepCurrentFrame) {
                            currentFrame = 0;
                        }
                    }
                },
                /**
                 * Returns the name of current animation playing
                 * @function
                 * @instance
                 * @returns {String} Name of the animation playing, null if not playing anything
                 * @name getAnimation
                 */
                getAnimation: function () {
                    return currentAnimation ? currentAnimation.name : null;
                },
                /**
                 * Set current animation to a certain frame
                 * @function
                 * @instance
                 * @param {Number} frameNumber - Frame number.
                 * @name setFrame
                 */
                setFrame: function (frameNumber) {
                    currentFrame = frameNumber;
                },
                /**
                 * Set speed of the current animation.
                 * @function
                 * @instance
                 * @param {Number} speed - Speed at which the animation plays.
                 * @name setCurrentSpeed
                 */
                setCurrentSpeed: function (value) {
                    currentAnimation.speed = value;
                },
                /**
                 * Returns the current frame number
                 * @function
                 * @instance
                 * @returns {Number} frameNumber - Not necessarily a round number.
                 * @name getCurrentFrame
                 */
                getCurrentFrame: function () {
                    return currentFrame;
                },
                /**
                 * Returns the frame width
                 * @function
                 * @instance
                 * @returns {Number} width - Width of the image frame.
                 * @name getFrameWidth
                 */
                getFrameWidth: function () {
                    return frameWidth;
                },
                /**
                 * Updates the component. Called by the entity holding the component every tick.
                 * @function
                 * @instance
                 * @param {Object} data - Game data object
                 * @name update
                 */
                update: function () {
                    var reachedEnd;
                    if (!currentAnimation) {
                        return;
                    }
                    reachedEnd = false;
                    currentFrame += currentAnimation.speed || 1;
                    if (currentAnimation.loop) {
                        while (currentFrame >= currentAnimation.frames.length) {
                            currentFrame -= currentAnimation.frames.length - currentAnimation.backTo;
                            reachedEnd = true;
                        }
                    } else {
                        if (currentFrame >= currentAnimation.frames.length) {
                            reachedEnd = true;
                        }
                    }
                    if (reachedEnd && onCompleteCallback) {
                        onCompleteCallback();
                    }
                },
                /**
                 * Draws the component. Called by the entity holding the component every tick.
                 * @function
                 * @instance
                 * @param {Object} data - Game data object
                 * @name draw
                 */
                draw: function (data) {
                    var cf, sx, sy;
                    if (!currentAnimation) {
                        return;
                    }
                    cf = Math.min(Math.floor(currentFrame), currentAnimation.frames.length - 1);
                    sx = (currentAnimation.frames[cf] % frameCountX) * frameWidth;
                    sy = Math.floor(currentAnimation.frames[cf] / frameCountX) * frameHeight;

                    data.renderer.translate(Math.round(-origin.x), Math.round(-origin.y));
                    data.renderer.drawImage(
                        spriteImage,
                        sx,
                        sy,
                        frameWidth,
                        frameHeight,
                        0,
                        0,
                        frameWidth,
                        frameHeight
                    );
                    data.renderer.translate(Math.round(origin.x), Math.round(origin.y));
                }
            };

        // call setup 
        if (settings && settings[component.name]) {
            component.setup(settings[component.name]);
        }

        entity.attach(component);
        mixin[component.name] = component;
        Utils.extend(entity, mixin);
        return entity;
    };
});
/**
 * Component that helps with detecting clicks on an entity
 * <br>Exports: Function
 * @module bento/components/clickable
 * @param {Entity} entity - The entity to attach the component to
 * @param {Object} settings - Settings
 * @returns Returns the entity passed. The entity will have the component attached.
 */
bento.define('bento/components/clickable', [
    'bento',
    'bento/utils',
    'bento/math/vector2',
    'bento/math/matrix',
    'bento/eventsystem'
], function (Bento, Utils, Vector2, Matrix, EventSystem) {
    'use strict';
    return function (entity, settings) {
        var mixin = {},
            isPointerDown = false,
            initialized = false,
            component = {
                /**
                 * Name of the component
                 * @instance
                 * @default 'clickable'
                 * @name name 
                 */
                name: 'clickable',
                /**
                 * Whether the pointer is over the entity
                 * @instance
                 * @default false
                 * @name isHovering
                 */
                isHovering: false,
                hasTouched: false,
                /**
                 * Id number of the pointer holding entity 
                 * @instance
                 * @default null
                 * @name holdId
                 */
                holdId: null,
                pointerDown: function (evt) {},
                pointerUp: function (evt) {},
                pointerMove: function (evt) {},
                // when clicking on the object
                onClick: function () {},
                onClickUp: function () {},
                onClickMiss: function () {},
                onHold: function () {},
                onHoldLeave: function () {},
                onHoldEnter: function () {},
                onHoldEnd: function () {},
                onHoverLeave: function () {},
                onHoverEnter: function () {},
                /**
                 * Destructs the component. Called by the entity holding the component.
                 * @function
                 * @instance
                 * @name destroy
                 */
                destroy: function () {
                    EventSystem.removeEventListener('pointerDown', pointerDown);
                    EventSystem.removeEventListener('pointerUp', pointerUp);
                    EventSystem.removeEventListener('pointerMove', pointerMove);
                    initialized = false;
                },
                /**
                 * Starts the component. Called by the entity holding the component.
                 * @function
                 * @instance
                 * @name start
                 */
                start: function () {
                    if (initialized) {
                        // TODO: this is caused by calling start when objects are attached, fix this later!
                        // console.log('warning: trying to init twice')
                        return;
                    }
                    EventSystem.addEventListener('pointerDown', pointerDown);
                    EventSystem.addEventListener('pointerUp', pointerUp);
                    EventSystem.addEventListener('pointerMove', pointerMove);
                    initialized = true;
                },
                /**
                 * Updates the component. Called by the entity holding the component every tick.
                 * @function
                 * @instance
                 * @param {Object} data - Game data object
                 * @name update
                 */
                update: function () {
                    if (this.isHovering && isPointerDown && this.onHold) {
                        this.onHold();
                    }
                }
            },
            cloneEvent = function (evt) {
                return {
                    id: evt.id,
                    position: evt.position.clone(),
                    eventType: evt.eventType,
                    localPosition: evt.localPosition.clone(),
                    worldPosition: evt.worldPosition.clone()
                };
            },
            pointerDown = function (evt) {
                var e = transformEvent(evt);
                if (Bento.objects && Bento.objects.isPaused() && !entity.updateWhenPaused) {
                    return;
                }
                isPointerDown = true;
                if (component.pointerDown) {
                    component.pointerDown(e);
                }
                if (entity.getBoundingBox) {
                    checkHovering(e, true);
                }
            },
            pointerUp = function (evt) {
                var e = transformEvent(evt),
                    mousePosition;
                if (Bento.objects && Bento.objects.isPaused() && !entity.updateWhenPaused) {
                    return;
                }
                mousePosition = e.localPosition;
                isPointerDown = false;
                if (component.pointerUp) {
                    component.pointerUp(e);
                }
                if (entity.getBoundingBox().hasPosition(mousePosition)) {
                    component.onClickUp(e);
                    if (component.hasTouched && component.holdId === e.id) {
                        component.holdId = null;
                        component.onHoldEnd(e);
                    }
                }
                component.hasTouched = false;
            },
            pointerMove = function (evt) {
                var e = transformEvent(evt);
                if (Bento.objects && Bento.objects.isPaused() && !entity.updateWhenPaused) {
                    return;
                }
                if (component.pointerMove) {
                    component.pointerMove(e);
                }
                // hovering?
                if (entity.getBoundingBox) {
                    checkHovering(e);
                }
            },
            checkHovering = function (evt, clicked) {
                var mousePosition = evt.localPosition;
                if (entity.getBoundingBox().hasPosition(mousePosition)) {
                    if (component.hasTouched && !component.isHovering && component.holdId === evt.id) {
                        component.onHoldEnter(evt);
                    }
                    if (!component.isHovering) {
                        component.onHoverEnter(evt);
                    }
                    component.isHovering = true;
                    if (clicked) {
                        component.hasTouched = true;
                        component.holdId = evt.id;
                        component.onClick(evt);
                    }
                } else {
                    if (component.hasTouched && component.isHovering && component.holdId === evt.id) {
                        component.onHoldLeave(evt);
                    }
                    if (component.isHovering) {
                        component.onHoverLeave(evt);
                    }
                    component.isHovering = false;
                    if (clicked) {
                        component.onClickMiss(evt);
                    }
                }
            },
            transformEvent = function (evt) {
                var positionVector,
                    translateMatrix = Matrix(3, 3),
                    scaleMatrix = Matrix(3, 3),
                    rotateMatrix = Matrix(3, 3),
                    sin,
                    cos,
                    type,
                    position,
                    parent,
                    parents = [],
                    i;

                // no parents
                if (!entity.getParent || !entity.getParent()) {
                    if (!entity.float) {
                        evt.localPosition = evt.worldPosition.clone();
                    } else {
                        evt.localPosition = evt.position.clone();
                    }
                    return evt;
                }
                // make a copy
                evt = cloneEvent(evt);
                if (entity.float) {
                    positionVector = evt.localPosition.toMatrix();
                } else {
                    positionVector = evt.worldPosition.toMatrix();
                }

                // get all parents
                parent = entity;
                while (parent.getParent && parent.getParent()) {
                    parent = parent.getParent();
                    parents.unshift(parent);
                }

                /** 
                 * reverse transform the event position vector
                 */
                for (i = 0; i < parents.length; ++i) {
                    parent = parents[i];

                    // construct a translation matrix and apply to position vector
                    if (parent.getPosition) {
                        position = parent.getPosition();
                        translateMatrix.set(2, 0, -position.x);
                        translateMatrix.set(2, 1, -position.y);
                        positionVector.multiplyWith(translateMatrix);
                    }
                    // only scale/rotatable if there is a component
                    if (parent.rotation) {
                        // construct a rotation matrix and apply to position vector
                        sin = Math.sin(-parent.rotation.getAngleRadian());
                        cos = Math.cos(-parent.rotation.getAngleRadian());
                        rotateMatrix.set(0, 0, cos);
                        rotateMatrix.set(1, 0, -sin);
                        rotateMatrix.set(0, 1, sin);
                        rotateMatrix.set(1, 1, cos);
                        positionVector.multiplyWith(rotateMatrix);
                    }
                    if (parent.scale) {
                        // construct a scaling matrix and apply to position vector
                        scaleMatrix.set(0, 0, 1 / parent.scale.getScale().x);
                        scaleMatrix.set(1, 1, 1 / parent.scale.getScale().y);
                        positionVector.multiplyWith(scaleMatrix);
                    }
                }
                evt.localPosition.x = positionVector.get(0, 0);
                evt.localPosition.y = positionVector.get(0, 1);

                return evt;
            };

        if (settings && settings[component.name]) {
            settings = settings[component.name];
            Utils.extend(component, settings);
        }

        entity.attach(component);
        mixin[component.name] = component;
        Utils.extend(entity, mixin);
        return entity;
    };
});
/**
 * Component that fills the screen
 * <br>Exports: Function
 * @module bento/components/clickable
 * @param {Entity} entity - The entity to attach the component to
 * @param {Object} settings - Settings
 * @returns Returns the entity passed. The entity will have the component attached.
 */
bento.define('bento/components/fill', [
    'bento/utils',
    'bento'
], function (Utils, Bento) {
    'use strict';
    return function (entity, settings) {
        var viewport = Bento.getViewport(),
            mixin = {},
            color = [0, 0, 0, 1],
            component = {
                name: 'fill',
                draw: function (data) {
                    data.renderer.fillRect(color, 0, 0, viewport.width, viewport.height);
                },
                setup: function (settings) {
                    color = settings.color;
                }
            };

        if (settings && settings[component.name]) {
            component.setup(settings[component.name]);
        }

        entity.attach(component);
        mixin[component.name] = component;
        Utils.extend(entity, mixin);
        return entity;
    };
});
/**
 * Component that sets the opacity
 * <br>Exports: Function
 * @module bento/components/opacity
 * @param {Entity} entity - The entity to attach the component to
 * @param {Object} settings - Settings
 * @returns Returns the entity passed. The entity will have the component attached.
 */
bento.define('bento/components/opacity', [
    'bento/utils',
    'bento/math/vector2'
], function (Utils, Vector2) {
    'use strict';
    return function (entity) {
        var opacity = 1,
            set = false,
            oldOpacity = 1,
            mixin = {},
            component = {
                name: 'opacity',
                draw: function (data) {
                    if (set) {
                        oldOpacity = data.renderer.getOpacity();
                        data.renderer.setOpacity(opacity);
                    }
                },
                postDraw: function (data) {
                    data.renderer.setOpacity(oldOpacity);
                },
                setOpacity: function (value) {
                    set = true;
                    opacity = value;
                },
                getOpacity: function () {
                    return opacity;
                }
            };
        entity.attach(component);
        mixin[component.name] = component;
        Utils.extend(entity, mixin);
        return entity;
    };
});
bento.define('bento/components/pixi', [
    'bento/utils'
], function (
    Utils
) {
    'use strict';
    if (!window.PIXI) {
        console.log('Warning: PIXI is not available');
        return function () {};
    }

    return function (entity, settings) {
        var pixiBaseTexture,
            pixiTexture,
            pixiSprite,
            animationSettings,
            animations = {},
            currentAnimation,
            mixin = {},
            currentFrame = 0,
            frameCountX = 1,
            frameCountY = 1,
            frameWidth = 0,
            frameHeight = 0,
            spriteImage,
            onCompleteCallback,
            component = {
                name: 'pixi',
                setup: function (settings) {
                    var rectangle,
                        crop;
                    if (settings) {
                        animationSettings = settings;
                    } else {
                        // create default animation
                        animationSettings = {
                            frameCountX: 1,
                            frameCountY: 1
                        };
                    }
                    // add default animation
                    if (!animationSettings.animations) {
                        animationSettings.animations = {};
                    }
                    if (!animationSettings.animations['default']) {
                        animationSettings.animations['default'] = {
                            frames: [0]
                        };
                    }

                    // get image
                    if (settings.image) {
                        spriteImage = settings.image;
                    } else if (settings.imageName) {
                        // load from string
                        if (Bento.assets) {
                            spriteImage = Bento.assets.getImage(settings.imageName);
                        } else {
                            throw 'Bento asset manager not loaded';
                        }
                    } else {
                        // no image specified
                        return;
                    }
                    // use frameWidth if specified (overrides frameCountX and frameCountY)
                    if (animationSettings.frameWidth) {
                        frameWidth = animationSettings.frameWidth;
                        frameCountX = Math.floor(spriteImage.width / frameWidth);
                    } else {
                        frameCountX = animationSettings.frameCountX || 1;
                        frameWidth = spriteImage.width / frameCountX;
                    }
                    if (animationSettings.frameHeight) {
                        frameHeight = animationSettings.frameHeight;
                        frameCountY = Math.floor(spriteImage.height / frameHeight);
                    } else {
                        frameCountY = animationSettings.frameCountY || 1;
                        frameHeight = spriteImage.height / frameCountY;
                    }
                    // set dimension of entity object
                    entity.getDimension().width = frameWidth;
                    entity.getDimension().height = frameHeight;
                    // set to default
                    animations = animationSettings.animations;
                    currentAnimation = animations['default'];

                    // PIXI
                    // initialize pixi
                    pixiBaseTexture = new PIXI.BaseTexture(spriteImage.image, PIXI.SCALE_MODES.NEAREST);
                    rectangle = new PIXI.Rectangle(spriteImage.x, spriteImage.y, frameWidth, frameHeight);
                    pixiTexture = new PIXI.Texture(pixiBaseTexture, rectangle);
                    pixiSprite = new PIXI.Sprite(pixiTexture);
                },
                /**
                 * Updates the component. Called by the entity holding the component every tick.
                 * @function
                 * @instance
                 * @param {Object} data - Game data object
                 * @name update
                 */
                update: function () {
                    var reachedEnd;
                    if (!currentAnimation) {
                        return;
                    }
                    reachedEnd = false;
                    currentFrame += currentAnimation.speed || 1;
                    if (currentAnimation.loop) {
                        while (currentFrame >= currentAnimation.frames.length) {
                            currentFrame -= currentAnimation.frames.length - currentAnimation.backTo;
                            reachedEnd = true;
                        }
                    } else {
                        if (currentFrame >= currentAnimation.frames.length) {
                            reachedEnd = true;
                        }
                    }
                    if (reachedEnd && onCompleteCallback) {
                        onCompleteCallback();
                    }
                },
                draw: function (data) {
                    // update pixi sprite, doesnt actually draw
                    var origin = entity.getOrigin(),
                        position = entity.getPosition(),
                        rotation,
                        scale,
                        rectangle,
                        cf,
                        sx,
                        sy;
                    if (!currentAnimation) {
                        //return;
                    }
                    cf = Math.min(Math.floor(currentFrame), currentAnimation.frames.length - 1);
                    sx = (currentAnimation.frames[cf] % frameCountX) * frameWidth;
                    sy = Math.floor(currentAnimation.frames[cf] / frameCountX) * frameHeight;

                    rectangle = new PIXI.Rectangle(spriteImage.x + sx, spriteImage.y + sy, frameWidth, frameHeight);

                    pixiTexture.frame = rectangle;

                    pixiSprite.x = position.x;
                    pixiSprite.y = position.y;
                    pixiSprite.pivot.x = origin.x;
                    pixiSprite.pivot.y = origin.y;

                    if (entity.scale) {
                        scale = entity.scale.getScale();
                        pixiSprite.scale.x = scale.x;
                        pixiSprite.scale.y = scale.y;
                    }
                    if (entity.rotation) {
                        rotation = entity.rotation.getAngleRadian();
                        pixiSprite.rotation = rotation;
                    }
                },
                destroy: function () {
                    data.renderer.removeChild(pixiSprite);
                },
                start: function (data) {
                    if (!pixiSprite) {
                        console.log('call setup first')
                        return;
                    }
                    if (data) {
                        // attach to roor
                        data.renderer.addChild(pixiSprite);
                    } else {
                        // attach to parent?
                    }
                },
                /**
                 * Set component to a different animation
                 * @function
                 * @instance
                 * @param {String} name - Name of the animation.
                 * @param {Function} callback - Called when animation ends.
                 * @param {Boolean} keepCurrentFrame - Prevents animation to jump back to frame 0
                 * @name setAnimation
                 */
                setAnimation: function (name, callback, keepCurrentFrame) {
                    var anim = animations[name];
                    if (!anim) {
                        console.log('Warning: animation ' + name + ' does not exist.');
                        return;
                    }
                    if (anim && currentAnimation !== anim) {
                        if (!Utils.isDefined(anim.loop)) {
                            anim.loop = true;
                        }
                        if (!Utils.isDefined(anim.backTo)) {
                            anim.backTo = 0;
                        }
                        // set even if there is no callback
                        onCompleteCallback = callback;
                        currentAnimation = anim;
                        currentAnimation.name = name;
                        if (!keepCurrentFrame) {
                            currentFrame = 0;
                        }
                    }
                },
                /**
                 * Returns the name of current animation playing
                 * @function
                 * @instance
                 * @returns {String} Name of the animation playing, null if not playing anything
                 * @name getAnimation
                 */
                getAnimation: function () {
                    return currentAnimation ? currentAnimation.name : null;
                },
                /**
                 * Set current animation to a certain frame
                 * @function
                 * @instance
                 * @param {Number} frameNumber - Frame number.
                 * @name setFrame
                 */
                setFrame: function (frameNumber) {
                    currentFrame = frameNumber;
                },
                /**
                 * Set speed of the current animation.
                 * @function
                 * @instance
                 * @param {Number} speed - Speed at which the animation plays.
                 * @name setCurrentSpeed
                 */
                setCurrentSpeed: function (value) {
                    currentAnimation.speed = value;
                },
                /**
                 * Returns the current frame number
                 * @function
                 * @instance
                 * @returns {Number} frameNumber - Not necessarily a round number.
                 * @name getCurrentFrame
                 */
                getCurrentFrame: function () {
                    return currentFrame;
                },
                /**
                 * Returns the frame width
                 * @function
                 * @instance
                 * @returns {Number} width - Width of the image frame.
                 * @name getFrameWidth
                 */
                getFrameWidth: function () {
                    return frameWidth;
                }
            };
        // call setup 
        if (settings && settings[component.name]) {
            component.setup(settings[component.name]);
        }

        entity.attach(component);
        mixin[component.name] = component;
        Utils.extend(entity, mixin);
        return entity;
    };
});
/**
 * Component that sets the rotation
 * <br>Exports: Function
 * @module bento/components/rotation
 * @param {Entity} entity - The entity to attach the component to
 * @param {Object} settings - Settings
 * @returns Returns the entity passed. The entity will have the component attached.
 */
bento.define('bento/components/rotation', [
    'bento/utils',
], function (Utils) {
    'use strict';
    return function (entity) {
        var angle,
            mixin = {},
            component = {
                name: 'rotation',
                draw: function (data) {
                    if (angle) {
                        data.renderer.rotate(angle);
                    }
                },
                postDraw: function (data) {
                },
                addAngleDegree: function (value) {
                    if (!angle) {
                        angle = 0;
                    }
                    angle += value * Math.PI / 180;
                },
                addAngleRadian: function (value) {
                    if (!angle) {
                        angle = 0;
                    }
                    angle += value;
                },
                setAngleDegree: function (value) {
                    angle = value * Math.PI / 180;
                },
                setAngleRadian: function (value) {
                    angle = value;
                },
                getAngleDegree: function () {
                    if (!angle) {
                        return 0;
                    }
                    return angle * 180 / Math.PI;
                },
                getAngleRadian: function () {
                    if (!angle) {
                        return 0;
                    }
                    return angle;
                }
            };
        entity.attach(component);
        mixin[component.name] = component;
        Utils.extend(entity, mixin);
        return entity;
    };
});
/**
 * Component that scales the entity
 * <br>Exports: Function
 * @module bento/components/scale
 * @param {Entity} entity - The entity to attach the component to
 * @param {Object} settings - Settings
 * @returns Returns the entity passed. The entity will have the component attached.
 */
bento.define('bento/components/scale', [
    'bento/utils',
    'bento/math/vector2'
], function (Utils, Vector2) {
    'use strict';
    return function (entity) {
        var set = false,
            scale = Vector2(1, 1),
            mixin = {},
            component = {
                name: 'scale',
                draw: function (data) {
                    if (set) {
                        data.renderer.scale(scale.x, scale.y);
                    }
                },
                setScale: function (vector) {
                    set = true;
                    scale = vector;
                },
                getScale: function () {
                    return scale;
                },
                setScaleX: function (value) {
                    set = true;
                    scale.x = value;
                },
                setScaleY: function (value) {
                    set = true;
                    scale.y = value;
                }
            };
        entity.attach(component);
        mixin[component.name] = component;
        Utils.extend(entity, mixin);
        return entity;
    };
});
/**
 * Helper function that attaches the translate, scale, rotation, opacity and animation components
 * <br>Exports: Function
 * @module bento/components/sprite
 * @param {Entity} entity - The entity to attach the component to
 * @param {Object} settings - Settings
 * @returns Returns the entity passed. The entity will have the component attached.
 */
bento.define('bento/components/sprite', [
    'bento/utils',
    'bento/components/translation',
    'bento/components/rotation',
    'bento/components/scale',
    'bento/components/opacity',
    'bento/components/animation'
], function (Utils, Translation, Rotation, Scale, Opacity, Animation) {
    'use strict';
    return function (entity, settings) {
        if (settings.sprite) {
            settings.animation = settings.sprite;
        }
        Translation(entity, settings);
        Scale(entity, settings);
        Rotation(entity, settings);
        Opacity(entity, settings);
        Animation(entity, settings);
        entity.sprite = entity.animation;
        Utils.extend(entity.sprite, entity.scale);
        Utils.extend(entity.sprite, entity.rotation);
        Utils.extend(entity.sprite, entity.opacity);
        return entity;
    };
});
/**
 * Component that translates the entity visually
 * <br>Exports: Function
 * @module bento/components/translation
 * @param {Entity} entity - The entity to attach the component to
 * @param {Object} settings - Settings
 * @returns Returns the entity passed. The entity will have the component attached.
 */
bento.define('bento/components/translation', [
    'bento/utils',
    'bento/math/vector2'
], function (Utils, Vector2) {
    'use strict';
    return function (entity) {
        var set = false,
            mixin = {},
            subPixel = false,
            component = {
                name: 'translation',
                setSubPixel: function (bool) {
                    subPixel = bool;
                },
                draw: function (data) {
                    var parent = entity.getParent(),
                        position = entity.getPosition(),
                        origin = entity.getOrigin(),
                        scroll = data.viewport;
                    data.renderer.save(entity);
                    if (subPixel) {
                        data.renderer.translate(position.x, position.y);
                    } else {
                        data.renderer.translate(Math.round(position.x), Math.round(position.y));                        
                    }

                    // scroll (only applies to parent objects)
                    if (parent === null && !entity.float) {
                        data.renderer.translate(Math.round(-scroll.x), Math.round(-scroll.y));
                    }
                },
                postDraw: function (data) {
                    data.renderer.restore();
                }
            };
        entity.attach(component);
        mixin[component.name] = component;
        Utils.extend(entity, mixin);
        return entity;
    };
});
/**
 * @license RequireJS domReady 2.0.1 Copyright (c) 2010-2012, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/requirejs/domReady for details
 */
/*jslint*/
/*global require: false, define: false, requirejs: false,
  window: false, clearInterval: false, document: false,
  self: false, setInterval: false */


bento.define('bento/lib/domready', [], function () {
    'use strict';

    var isTop, testDiv, scrollIntervalId,
        isBrowser = typeof window !== "undefined" && window.document,
        isPageLoaded = !isBrowser,
        doc = isBrowser ? document : null,
        readyCalls = [];

    function runCallbacks(callbacks) {
        var i;
        for (i = 0; i < callbacks.length; i += 1) {
            callbacks[i](doc);
        }
    }

    function callReady() {
        var callbacks = readyCalls;

        if (isPageLoaded) {
            //Call the DOM ready callbacks
            if (callbacks.length) {
                readyCalls = [];
                runCallbacks(callbacks);
            }
        }
    }

    /**
     * Sets the page as loaded.
     */
    function pageLoaded() {
        if (!isPageLoaded) {
            isPageLoaded = true;
            if (scrollIntervalId) {
                clearInterval(scrollIntervalId);
            }

            callReady();
        }
    }

    if (isBrowser) {
        if (document.addEventListener) {
            //Standards. Hooray! Assumption here that if standards based,
            //it knows about DOMContentLoaded.
            document.addEventListener("DOMContentLoaded", pageLoaded, false);
            window.addEventListener("load", pageLoaded, false);
        } else if (window.attachEvent) {
            window.attachEvent("onload", pageLoaded);

            testDiv = document.createElement('div');
            try {
                isTop = window.frameElement === null;
            } catch (e) {}

            //DOMContentLoaded approximation that uses a doScroll, as found by
            //Diego Perini: http://javascript.nwbox.com/IEContentLoaded/,
            //but modified by other contributors, including jdalton
            if (testDiv.doScroll && isTop && window.external) {
                scrollIntervalId = setInterval(function () {
                    try {
                        testDiv.doScroll();
                        pageLoaded();
                    } catch (e) {}
                }, 30);
            }
        }

        //Check if document already complete, and if so, just trigger page load
        //listeners. Latest webkit browsers also use "interactive", and
        //will fire the onDOMContentLoaded before "interactive" but not after
        //entering "interactive" or "complete". More details:
        //http://dev.w3.org/html5/spec/the-end.html#the-end
        //http://stackoverflow.com/questions/3665561/document-readystate-of-interactive-vs-ondomcontentloaded
        //Hmm, this is more complicated on further use, see "firing too early"
        //bug: https://github.com/requirejs/domReady/issues/1
        //so removing the || document.readyState === "interactive" test.
        //There is still a window.onload binding that should get fired if
        //DOMContentLoaded is missed.
        if (document.readyState === "complete") {
            pageLoaded();
        }
    }

    /** START OF PUBLIC API **/

    /**
     * Registers a callback for DOM ready. If DOM is already ready, the
     * callback is called immediately.
     * @param {Function} callback
     */
    function domReady(callback) {
        if (isPageLoaded) {
            callback(doc);
        } else {
            readyCalls.push(callback);
        }
        return domReady;
    }

    domReady.version = '2.0.1';

    /**
     * Loader Plugin API method
     */
    domReady.load = function (name, req, onLoad, config) {
        if (config.isBuild) {
            onLoad(null);
        } else {
            domReady(onLoad);
        }
    };

    /** END OF PUBLIC API **/

    return domReady;
});

// https://gist.github.com/kirbysayshi/1760774

bento.define('hshg', [], function () {

    //---------------------------------------------------------------------
    // GLOBAL FUNCTIONS
    //---------------------------------------------------------------------

    /**
     * Updates every object's position in the grid, but only if
     * the hash value for that object has changed.
     * This method DOES NOT take into account object expansion or
     * contraction, just position, and does not attempt to change
     * the grid the object is currently in; it only (possibly) changes
     * the cell.
     *
     * If the object has significantly changed in size, the best bet is to
     * call removeObject() and addObject() sequentially, outside of the
     * normal update cycle of HSHG.
     *
     * @return  void   desc
     */
    function update_RECOMPUTE() {

        var i, obj, grid, meta, objAABB, newObjHash;

        // for each object
        for (i = 0; i < this._globalObjects.length; i++) {
            obj = this._globalObjects[i];
            meta = obj.HSHG;
            grid = meta.grid;

            // recompute hash
            objAABB = obj.getAABB();
            newObjHash = grid.toHash(objAABB.min[0], objAABB.min[1]);

            if (newObjHash !== meta.hash) {
                // grid position has changed, update!
                grid.removeObject(obj);
                grid.addObject(obj, newObjHash);
            }
        }
    }

    // not implemented yet :)
    function update_REMOVEALL() {

    }

    function testAABBOverlap(objA, objB) {
        var a = objA.getAABB(),
            b = objB.getAABB();

        //if(a.min[0] > b.max[0] || a.min[1] > b.max[1] || a.min[2] > b.max[2]
        //|| a.max[0] < b.min[0] || a.max[1] < b.min[1] || a.max[2] < b.min[2]){

        if (a.min[0] > b.max[0] || a.min[1] > b.max[1] || a.max[0] < b.min[0] || a.max[1] < b.min[1]) {
            return false;
        } else {
            return true;
        }
    }

    function getLongestAABBEdge(min, max) {
        return Math.max(
            Math.abs(max[0] - min[0]), Math.abs(max[1] - min[1])
            //,Math.abs(max[2] - min[2])
        );
    }

    //---------------------------------------------------------------------
    // ENTITIES
    //---------------------------------------------------------------------

    function HSHG() {

        this.MAX_OBJECT_CELL_DENSITY = 1 / 8 // objects / cells
        this.INITIAL_GRID_LENGTH = 256 // 16x16
        this.HIERARCHY_FACTOR = 2
        this.HIERARCHY_FACTOR_SQRT = Math.SQRT2
        this.UPDATE_METHOD = update_RECOMPUTE // or update_REMOVEALL

        this._grids = [];
        this._globalObjects = [];
    }

    //HSHG.prototype.init = function(){
    //  this._grids = [];
    //  this._globalObjects = [];
    //}

    HSHG.prototype.addObject = function (obj) {
        var x, i, cellSize, objAABB = obj.getAABB(),
            objSize = getLongestAABBEdge(objAABB.min, objAABB.max),
            oneGrid, newGrid;

        // for HSHG metadata
        obj.HSHG = {
            globalObjectsIndex: this._globalObjects.length
        };

        // add to global object array
        this._globalObjects.push(obj);

        if (this._grids.length == 0) {
            // no grids exist yet
            cellSize = objSize * this.HIERARCHY_FACTOR_SQRT;
            newGrid = new Grid(cellSize, this.INITIAL_GRID_LENGTH, this);
            newGrid.initCells();
            newGrid.addObject(obj);

            this._grids.push(newGrid);
        } else {
            x = 0;

            // grids are sorted by cellSize, smallest to largest
            for (i = 0; i < this._grids.length; i++) {
                oneGrid = this._grids[i];
                x = oneGrid.cellSize;
                if (objSize < x) {
                    x = x / this.HIERARCHY_FACTOR;
                    if (objSize < x) {
                        // find appropriate size
                        while (objSize < x) {
                            x = x / this.HIERARCHY_FACTOR;
                        }
                        newGrid = new Grid(x * this.HIERARCHY_FACTOR, this.INITIAL_GRID_LENGTH, this);
                        newGrid.initCells();
                        // assign obj to grid
                        newGrid.addObject(obj)
                        // insert grid into list of grids directly before oneGrid
                        this._grids.splice(i, 0, newGrid);
                    } else {
                        // insert obj into grid oneGrid
                        oneGrid.addObject(obj);
                    }
                    return;
                }
            }

            while (objSize >= x) {
                x = x * this.HIERARCHY_FACTOR;
            }

            newGrid = new Grid(x, this.INITIAL_GRID_LENGTH, this);
            newGrid.initCells();
            // insert obj into grid
            newGrid.addObject(obj)
            // add newGrid as last element in grid list
            this._grids.push(newGrid);
        }
    }

    HSHG.prototype.removeObject = function (obj) {
        var meta = obj.HSHG,
            globalObjectsIndex, replacementObj;

        if (meta === undefined) {
            //throw Error(obj + ' was not in the HSHG.');
            return;
        }

        // remove object from global object list
        globalObjectsIndex = meta.globalObjectsIndex
        if (globalObjectsIndex === this._globalObjects.length - 1) {
            this._globalObjects.pop();
        } else {
            replacementObj = this._globalObjects.pop();
            replacementObj.HSHG.globalObjectsIndex = globalObjectsIndex;
            this._globalObjects[globalObjectsIndex] = replacementObj;
        }

        meta.grid.removeObject(obj);

        // remove meta data
        delete obj.HSHG;
    }

    HSHG.prototype.update = function () {
        this.UPDATE_METHOD.call(this);
    }

    HSHG.prototype.queryForCollisionPairs = function (broadOverlapTestCallback) {

        var i, j, k, l, c, grid, cell, objA, objB, offset, adjacentCell, biggerGrid, objAAABB, objAHashInBiggerGrid, possibleCollisions = []

        // default broad test to internal aabb overlap test
        broadOverlapTest = broadOverlapTestCallback || testAABBOverlap;

        // for all grids ordered by cell size ASC
        for (i = 0; i < this._grids.length; i++) {
            grid = this._grids[i];

            // for each cell of the grid that is occupied
            for (j = 0; j < grid.occupiedCells.length; j++) {
                cell = grid.occupiedCells[j];

                // collide all objects within the occupied cell
                for (k = 0; k < cell.objectContainer.length; k++) {
                    objA = cell.objectContainer[k];
                    if (objA.staticHshg) {
                        continue;
                    }
                    for (l = k + 1; l < cell.objectContainer.length; l++) {
                        objB = cell.objectContainer[l];
                        if (broadOverlapTest(objA, objB) === true) {
                            possibleCollisions.push([objA, objB]);
                        }
                    }
                }

                // for the first half of all adjacent cells (offset 4 is the current cell)
                for (c = 0; c < 4; c++) {
                    offset = cell.neighborOffsetArray[c];

                    //if(offset === null) { continue; }

                    adjacentCell = grid.allCells[cell.allCellsIndex + offset];

                    // collide all objects in cell with adjacent cell
                    for (k = 0; k < cell.objectContainer.length; k++) {
                        objA = cell.objectContainer[k];
                        if (objA.staticHshg) {
                            continue;
                        }
                        for (l = 0; l < adjacentCell.objectContainer.length; l++) {
                            objB = adjacentCell.objectContainer[l];
                            if (broadOverlapTest(objA, objB) === true) {
                                possibleCollisions.push([objA, objB]);
                            }
                        }
                    }
                }
            }

            // forall objects that are stored in this grid
            for (j = 0; j < grid.allObjects.length; j++) {
                objA = grid.allObjects[j];
                if (objA.staticHshg) {
                    continue;
                }
                objAAABB = objA.getAABB();

                // for all grids with cellsize larger than grid
                for (k = i + 1; k < this._grids.length; k++) {
                    biggerGrid = this._grids[k];
                    objAHashInBiggerGrid = biggerGrid.toHash(objAAABB.min[0], objAAABB.min[1]);
                    cell = biggerGrid.allCells[objAHashInBiggerGrid];

                    // check objA against every object in all cells in offset array of cell
                    // for all adjacent cells...
                    for (c = 0; c < cell.neighborOffsetArray.length; c++) {
                        offset = cell.neighborOffsetArray[c];

                        //if(offset === null) { continue; }

                        adjacentCell = biggerGrid.allCells[cell.allCellsIndex + offset];

                        // for all objects in the adjacent cell...
                        for (l = 0; l < adjacentCell.objectContainer.length; l++) {
                            objB = adjacentCell.objectContainer[l];
                            // test against object A
                            if (broadOverlapTest(objA, objB) === true) {
                                possibleCollisions.push([objA, objB]);
                            }
                        }
                    }
                }
            }
        }

        //
        for (i = 0; i < possibleCollisions.length; ++i) {
            if (possibleCollisions[i][0].onCollide) {
                possibleCollisions[i][0].onCollide(possibleCollisions[i][1]);
            }
            if (possibleCollisions[i][1].onCollide) {
                possibleCollisions[i][1].onCollide(possibleCollisions[i][0]);
            }
        }

        // return list of object pairs
        return possibleCollisions;
    }

    HSHG.update_RECOMPUTE = update_RECOMPUTE;
    HSHG.update_REMOVEALL = update_REMOVEALL;

    /**
     * Grid
     *
     * @constructor
     * @param   int cellSize  the pixel size of each cell of the grid
     * @param   int cellCount  the total number of cells for the grid (width x height)
     * @param   HSHG parentHierarchy    the HSHG to which this grid belongs
     * @return  void
     */
    function Grid(cellSize, cellCount, parentHierarchy) {
        this.cellSize = cellSize;
        this.inverseCellSize = 1 / cellSize;
        this.rowColumnCount = ~~Math.sqrt(cellCount);
        this.xyHashMask = this.rowColumnCount - 1;
        this.occupiedCells = [];
        this.allCells = Array(this.rowColumnCount * this.rowColumnCount);
        this.allObjects = [];
        this.sharedInnerOffsets = [];

        this._parentHierarchy = parentHierarchy || null;
    }

    Grid.prototype.initCells = function () {

        // TODO: inner/unique offset rows 0 and 2 may need to be
        // swapped due to +y being "down" vs "up"

        var i, gridLength = this.allCells.length,
            x, y, wh = this.rowColumnCount,
            isOnRightEdge, isOnLeftEdge, isOnTopEdge, isOnBottomEdge, innerOffsets = [
                // y+ down offsets
                //-1 + -wh, -wh, -wh + 1,
                //-1, 0, 1,
                //wh - 1, wh, wh + 1

                // y+ up offsets
                wh - 1, wh, wh + 1, -1, 0, 1, -1 + -wh, -wh, -wh + 1
            ],
            leftOffset, rightOffset, topOffset, bottomOffset, uniqueOffsets = [],
            cell;

        this.sharedInnerOffsets = innerOffsets;

        // init all cells, creating offset arrays as needed

        for (i = 0; i < gridLength; i++) {

            cell = new Cell();
            // compute row (y) and column (x) for an index
            y = ~~ (i / this.rowColumnCount);
            x = ~~ (i - (y * this.rowColumnCount));

            // reset / init
            isOnRightEdge = false;
            isOnLeftEdge = false;
            isOnTopEdge = false;
            isOnBottomEdge = false;

            // right or left edge cell
            if ((x + 1) % this.rowColumnCount == 0) {
                isOnRightEdge = true;
            } else if (x % this.rowColumnCount == 0) {
                isOnLeftEdge = true;
            }

            // top or bottom edge cell
            if ((y + 1) % this.rowColumnCount == 0) {
                isOnTopEdge = true;
            } else if (y % this.rowColumnCount == 0) {
                isOnBottomEdge = true;
            }

            // if cell is edge cell, use unique offsets, otherwise use inner offsets
            if (isOnRightEdge || isOnLeftEdge || isOnTopEdge || isOnBottomEdge) {

                // figure out cardinal offsets first
                rightOffset = isOnRightEdge === true ? -wh + 1 : 1;
                leftOffset = isOnLeftEdge === true ? wh - 1 : -1;
                topOffset = isOnTopEdge === true ? -gridLength + wh : wh;
                bottomOffset = isOnBottomEdge === true ? gridLength - wh : -wh;

                // diagonals are composites of the cardinals            
                uniqueOffsets = [
                    // y+ down offset
                    //leftOffset + bottomOffset, bottomOffset, rightOffset + bottomOffset,
                    //leftOffset, 0, rightOffset,
                    //leftOffset + topOffset, topOffset, rightOffset + topOffset

                    // y+ up offset
                    leftOffset + topOffset, topOffset, rightOffset + topOffset,
                    leftOffset, 0, rightOffset,
                    leftOffset + bottomOffset, bottomOffset, rightOffset + bottomOffset
                ];

                cell.neighborOffsetArray = uniqueOffsets;
            } else {
                cell.neighborOffsetArray = this.sharedInnerOffsets;
            }

            cell.allCellsIndex = i;
            this.allCells[i] = cell;
        }
    }

    Grid.prototype.toHash = function (x, y, z) {
        var i, xHash, yHash, zHash;

        if (x < 0) {
            i = (-x) * this.inverseCellSize;
            xHash = this.rowColumnCount - 1 - (~~i & this.xyHashMask);
        } else {
            i = x * this.inverseCellSize;
            xHash = ~~i & this.xyHashMask;
        }

        if (y < 0) {
            i = (-y) * this.inverseCellSize;
            yHash = this.rowColumnCount - 1 - (~~i & this.xyHashMask);
        } else {
            i = y * this.inverseCellSize;
            yHash = ~~i & this.xyHashMask;
        }

        //if(z < 0){
        //  i = (-z) * this.inverseCellSize;
        //  zHash = this.rowColumnCount - 1 - ( ~~i & this.xyHashMask );
        //} else {
        //  i = z * this.inverseCellSize;
        //  zHash = ~~i & this.xyHashMask;
        //}

        return xHash + yHash * this.rowColumnCount
            //+ zHash * this.rowColumnCount * this.rowColumnCount;
    }

    Grid.prototype.addObject = function (obj, hash) {
        var objAABB, objHash, targetCell;

        // technically, passing this in this should save some computational effort when updating objects
        if (hash !== undefined) {
            objHash = hash;
        } else {
            objAABB = obj.getAABB()
            objHash = this.toHash(objAABB.min[0], objAABB.min[1])
        }
        targetCell = this.allCells[objHash];

        if (targetCell.objectContainer.length === 0) {
            // insert this cell into occupied cells list
            targetCell.occupiedCellsIndex = this.occupiedCells.length;
            this.occupiedCells.push(targetCell);
        }

        // add meta data to obj, for fast update/removal
        obj.HSHG.objectContainerIndex = targetCell.objectContainer.length;
        obj.HSHG.hash = objHash;
        obj.HSHG.grid = this;
        obj.HSHG.allGridObjectsIndex = this.allObjects.length;
        // add obj to cell
        targetCell.objectContainer.push(obj);

        // we can assume that the targetCell is already a member of the occupied list

        // add to grid-global object list
        this.allObjects.push(obj);

        // do test for grid density
        if (this.allObjects.length / this.allCells.length > this._parentHierarchy.MAX_OBJECT_CELL_DENSITY) {
            // grid must be increased in size
            this.expandGrid();
        }
    }

    Grid.prototype.removeObject = function (obj) {
        var meta = obj.HSHG,
            hash, containerIndex, allGridObjectsIndex, cell, replacementCell, replacementObj;

        hash = meta.hash;
        containerIndex = meta.objectContainerIndex;
        allGridObjectsIndex = meta.allGridObjectsIndex;
        cell = this.allCells[hash];

        // remove object from cell object container
        if (cell.objectContainer.length === 1) {
            // this is the last object in the cell, so reset it
            cell.objectContainer.length = 0;

            // remove cell from occupied list
            if (cell.occupiedCellsIndex === this.occupiedCells.length - 1) {
                // special case if the cell is the newest in the list
                this.occupiedCells.pop();
            } else {
                replacementCell = this.occupiedCells.pop();
                replacementCell.occupiedCellsIndex = cell.occupiedCellsIndex;
                this.occupiedCells[cell.occupiedCellsIndex] = replacementCell;
            }

            cell.occupiedCellsIndex = null;
        } else {
            // there is more than one object in the container
            if (containerIndex === cell.objectContainer.length - 1) {
                // special case if the obj is the newest in the container
                cell.objectContainer.pop();
            } else {
                replacementObj = cell.objectContainer.pop();
                replacementObj.HSHG.objectContainerIndex = containerIndex;
                cell.objectContainer[containerIndex] = replacementObj;
            }
        }

        // remove object from grid object list
        if (allGridObjectsIndex === this.allObjects.length - 1) {
            this.allObjects.pop();
        } else {
            replacementObj = this.allObjects.pop();
            replacementObj.HSHG.allGridObjectsIndex = allGridObjectsIndex;
            this.allObjects[allGridObjectsIndex] = replacementObj;
        }
    }

    Grid.prototype.expandGrid = function () {
        var i, j, currentCellCount = this.allCells.length,
            currentRowColumnCount = this.rowColumnCount,
            currentXYHashMask = this.xyHashMask

        , newCellCount = currentCellCount * 4 // double each dimension
        , newRowColumnCount = ~~Math.sqrt(newCellCount), newXYHashMask = newRowColumnCount - 1, allObjects = this.allObjects.slice(0) // duplicate array, not objects contained
        , aCell, push = Array.prototype.push;

        // remove all objects
        for (i = 0; i < allObjects.length; i++) {
            this.removeObject(allObjects[i]);
        }

        // reset grid values, set new grid to be 4x larger than last
        this.rowColumnCount = newRowColumnCount;
        this.allCells = Array(this.rowColumnCount * this.rowColumnCount);
        this.xyHashMask = newXYHashMask;

        // initialize new cells
        this.initCells();

        // re-add all objects to grid
        for (i = 0; i < allObjects.length; i++) {
            this.addObject(allObjects[i]);
        }
    }

    /**
     * A cell of the grid
     *
     * @constructor
     * @return  void   desc
     */
    function Cell() {
        this.objectContainer = [];
        this.neighborOffsetArray;
        this.occupiedCellsIndex = null;
        this.allCellsIndex = null;
    }

    //---------------------------------------------------------------------
    // EXPORTS
    //---------------------------------------------------------------------

    HSHG._private = {
        Grid: Grid,
        Cell: Cell,
        testAABBOverlap: testAABBOverlap,
        getLongestAABBEdge: getLongestAABBEdge
    };

    return HSHG;
});
// http://www.makeitgo.ws/articles/animationframe/
// http://paulirish.com/2011/requestanimationframe-for-smart-animating/
// http://my.opera.com/emoller/blog/2011/12/20/requestanimationframe-for-smart-er-animating
// requestAnimationFrame polyfill by Erik Möller. fixes from Paul Irish and Tino Zijdel
bento.define('bento/lib/requestanimationframe', [], function () {
    'use strict';

    var lastTime = 0,
        vendors = ['ms', 'moz', 'webkit', 'o'];
    for (var x = 0; x < vendors.length && !window.requestAnimationFrame; ++x) {
        window.requestAnimationFrame = window[vendors[x] + 'RequestAnimationFrame'];
        window.cancelAnimationFrame = window[vendors[x] + 'CancelAnimationFrame'] || window[vendors[x] + 'CancelRequestAnimationFrame'];
    }

    if (!window.requestAnimationFrame)
        window.requestAnimationFrame = function (callback, element) {
            var currTime = new Date().getTime(),
                timeToCall = Math.max(0, 16 - (currTime - lastTime)),
                id = window.setTimeout(function () {
                    callback(currTime + timeToCall);
                }, timeToCall);
            lastTime = currTime + timeToCall;
            return id;
        };

    if (!window.cancelAnimationFrame)
        window.cancelAnimationFrame = function (id) {
            clearTimeout(id);
        };
    return window.requestAnimationFrame;
});
/**
 * Manager that loads and controls assets
 * <br>Exports: Function
 * @module bento/managers/asset
 * @returns AssetManager
 */
bento.define('bento/managers/asset', [
    'bento/packedimage',
    'bento/utils'
], function (PackedImage, Utils) {
    'use strict';
    return function () {
        var assetGroups = {},
            path = '',
            assets = {
                audio: {},
                json: {},
                images: {},
                binary: {}
            },
            texturePacker = {},
            packs = [],
            loadAudio = function (name, source, callback) {
                var asset,
                    i;
                if (!Utils.isArray(source)) {
                    source = [path + 'audio/' + source];
                } else {
                    // prepend asset paths
                    for (i = 0; i < source.length; i += 1) {
                        source[i] = path + 'audio/' + source[i];
                    }
                }
                // TEMP: use howler
                if (Utils.isDefined(window.Howl)) {
                    asset = new Howl({
                        urls: source,
                        onload: callback
                    });
                    assets.audio[name] = asset;
                } else {
                    // TODO: load audio and add audio manager
                    callback();
                }
            },
            loadJSON = function (name, source, callback) {
                var xhr = new XMLHttpRequest();
                if (xhr.overrideMimeType) {
                    xhr.overrideMimeType('application/json');
                }
                xhr.open('GET', source, true);
                xhr.onerror = function () {
                    callback('Error ' + source);
                };
                xhr.ontimeout = function () {
                    callback('Timeout' + source);
                };
                xhr.onreadystatechange = function () {
                    if (xhr.readyState === 4) {
                        if ((xhr.status === 304) || (xhr.status === 200) || ((xhr.status === 0) && xhr.responseText)) {
                            callback(null, name, JSON.parse(xhr.responseText));
                        } else {
                            callback('Error: State ' + xhr.readyState + ' ' + source);
                        }
                    }
                };
                xhr.send(null);
            },
            loadBinary = function (name, source, success, failure) {
                var xhr = new XMLHttpRequest(),
                    arrayBuffer,
                    byteArray,
                    buffer,
                    i = 0;

                xhr.open('GET', source, true);
                xhr.onerror = function () {
                    callback('Error ' + name);
                };
                xhr.responseType = 'arraybuffer';
                xhr.onload = function (e) {
                    var binary;
                    arrayBuffer = xhr.response;
                    if (arrayBuffer) {
                        byteArray = new Uint8Array(arrayBuffer);
                        buffer = [];
                        for (i; i < byteArray.byteLength; ++i) {
                            buffer[i] = String.fromCharCode(byteArray[i]);
                        }
                        // loadedAssets.binary[name] = buffer.join('');
                        binary = buffer.join('');
                        callback(null, name, binary);
                    }
                };
                xhr.send();
            },
            loadImage = function (name, source, callback) {
                // TODO: Implement failure
                var img = new Image();
                img.src = source;
                img.addEventListener('load', function () {
                    callback(null, name, img);
                }, false);
            },
            /**
             * Loads json files containing asset paths to load
             * @function
             * @instance
             * @param {Object} jsonFiles - Name with json path
             * @param {Function} onReady - Callback when ready
             * @param {Function} onLoaded - Callback when json file is loaded
             * @name loadAssetGroups
             */
            loadAssetGroups = function (jsonFiles, onReady, onLoaded) {
                var jsonName,
                    keyCount = Utils.getKeyLength(jsonFiles),
                    loaded = 0,
                    callback = function (err, name, json) {
                        if (err) {
                            console.log(err);
                            return;
                        }
                        assetGroups[name] = json;
                        loaded += 1;
                        if (Utils.isDefined(onLoaded)) {
                            onLoaded(loaded, keyCount);
                        }
                        if (keyCount === loaded && Utils.isDefined(onReady)) {
                            onReady(null);
                        }
                    };
                for (jsonName in jsonFiles) {
                    if (jsonFiles.hasOwnProperty(jsonName)) {
                        loadJSON(jsonName, jsonFiles[jsonName], callback);
                    }
                }
            },
            /**
             * Loads assets from asset group
             * @function
             * @instance
             * @param {String} groupName - Name of asset group
             * @param {Function} onReady - Callback when ready
             * @param {Function} onLoaded - Callback when asset file is loaded
             * @name load
             */
            load = function (groupName, onReady, onLoaded) {
                var group = assetGroups[groupName],
                    asset,
                    assetsLoaded = 0,
                    assetCount = 0,
                    checkLoaded = function () {
                        if (assetsLoaded === assetCount && Utils.isDefined(onReady)) {
                            initPackedImages();
                            onReady(null);
                        }
                    },
                    onLoadImage = function (err, name, image) {
                        if (err) {
                            console.log(err);
                            return;
                        }
                        assets.images[name] = image;
                        assetsLoaded += 1;
                        if (Utils.isDefined(onLoaded)) {
                            onLoaded(assetsLoaded, assetCount);
                        }
                        checkLoaded();
                    },
                    onLoadPack = function (err, name, json) {
                        if (err) {
                            console.log(err);
                            return;
                        }
                        assets.json[name] = json;
                        packs.push(name);
                        assetsLoaded += 1;
                        if (Utils.isDefined(onLoaded)) {
                            onLoaded(assetsLoaded, assetCount);
                        }
                        checkLoaded();
                    },
                    onLoadJson = function (err, name, json) {
                        if (err) {
                            console.log(err);
                            return;
                        }
                        assets.json[name] = json;
                        assetsLoaded += 1;
                        if (Utils.isDefined(onLoaded)) {
                            onLoaded(assetsLoaded, assetCount);
                        }
                        checkLoaded();
                    },
                    onLoadAudio = function () {
                        assetsLoaded += 1;
                        if (Utils.isDefined(onLoaded)) {
                            onLoaded(assetsLoaded, assetCount);
                        }
                        checkLoaded();
                    };

                if (!Utils.isDefined(group)) {
                    onReady('Could not find asset group ' + groupName);
                    return;
                }
                // set path
                if (Utils.isDefined(group.path)) {
                    path = group.path;
                }
                // load images
                if (Utils.isDefined(group.images)) {
                    assetCount += Utils.getKeyLength(group.images);
                    for (asset in group.images) {
                        if (!group.images.hasOwnProperty(asset)) {
                            continue;
                        }
                        loadImage(asset, path + 'images/' + group.images[asset], onLoadImage);
                    }
                }
                // load packed images
                if (Utils.isDefined(group.texturePacker)) {
                    assetCount += Utils.getKeyLength(group.texturePacker);
                    for (asset in group.texturePacker) {
                        if (!group.texturePacker.hasOwnProperty(asset)) {
                            continue;
                        }
                        loadJSON(asset, path + 'json/' + group.texturePacker[asset], onLoadPack);
                    }
                }
                // load audio
                if (Utils.isDefined(group.audio)) {
                    assetCount += Utils.getKeyLength(group.audio);
                    for (asset in group.audio) {
                        if (!group.audio.hasOwnProperty(asset)) {
                            continue;
                        }
                        loadAudio(asset, group.audio[asset], onLoadAudio);
                    }
                }
                // load json
                if (Utils.isDefined(group.json)) {
                    assetCount += Utils.getKeyLength(group.json);
                    for (asset in group.json) {
                        if (!group.json.hasOwnProperty(asset)) {
                            continue;
                        }
                        loadJSON(asset, path + 'json/' + group.json[asset], onLoadJson);
                    }
                }

            },
            /**
             * Unloads assets (not implemented yet)
             * @function
             * @instance
             * @param {String} groupName - Name of asset group
             * @name unload
             */
            unload = function (groupName) {},
            /**
             * Returns a previously loaded image
             * @function
             * @instance
             * @param {String} name - Name of image
             * @returns {PackedImage} Image
             * @name getImage
             */
            getImage = function (name) {
                var image, packedImage = texturePacker[name];
                if (!packedImage) {
                    image = getImageElement(name);
                    if (!image) {
                        throw 'Can not find ' + name;
                    }
                    packedImage = PackedImage(image);
                    texturePacker[name] = packedImage;
                }
                return packedImage;
            },
            /**
             * Returns a previously loaded image element
             * @function
             * @instance
             * @param {String} name - Name of image
             * @returns {HTMLImage} Html Image element
             * @name getImageElement
             */
            getImageElement = function (name) {
                var asset = assets.images[name];
                if (!Utils.isDefined(asset)) {
                    throw ('Asset ' + name + ' could not be found');
                }
                return asset;
            },
            /**
             * Returns a previously loaded json object
             * @function
             * @instance
             * @param {String} name - Name of image
             * @returns {Object} Json object
             * @name getJson
             */
            getJson = function (name) {
                var asset = assets.json[name];
                if (!Utils.isDefined(asset)) {
                    throw ('Asset ' + name + ' could not be found');
                }
                return asset;
            },
            /**
             * Returns a previously loaded audio element (currently by howler)
             * @function
             * @instance
             * @param {String} name - Name of image
             * @returns {Howl} Howler object
             * @name getAudio
             */
            getAudio = function (name) {
                var asset = assets.audio[name];
                if (!Utils.isDefined(asset)) {
                    throw ('Asset ' + name + ' could not be found');
                }
                return asset;
            },
            /**
             * Returns all assets
             * @function
             * @instance
             * @param {String} name - Name of image
             * @returns {Object} assets - Object with reference to all loaded assets
             * @name getAssets
             */
            getAssets = function () {
                return assets;
            },
            initPackedImages = function () {
                var frame, pack, i, image, json;
                while (packs.length) {
                    pack = packs.pop();
                    image = getImageElement(pack);
                    json = getJson(pack);

                    // parse json
                    for (i = 0; i < json.frames.length; ++i) {
                        name = json.frames[i].filename;
                        name = name.substring(0, name.length - 4);
                        frame = json.frames[i].frame;
                        texturePacker[name] = PackedImage(image, frame);
                    }
                    console.log(texturePacker);
                }
            };
        return {
            loadAssetGroups: loadAssetGroups,
            load: load,
            unload: unload,
            getImage: getImage,
            getImageElement: getImageElement,
            getJson: getJson,
            getAudio: getAudio,
            getAssets: getAssets
        };
    };
});
/**
 * Audio manager (To be rewritten)
 * <br>Exports: Function
 * @module bento/managers/audio
 * @returns AssetManager
 */

define('bento/managers/audio', [
    'bento/utils'
], function (Utils) {
    return function (bento) {
        var volume = 1,
            mutedSound = false,
            mutedMusic = false,
            preventSounds = false,
            howler,
            musicLoop = false,
            lastMusicPlayed = '',
            currentMusicId = 0,
            saveMuteSound,
            saveMuteMusic,
            assetManager = bento.assets,
            canvasElement = bento.getCanvas(),
            onVisibilityChanged = function (hidden) {
                if (hidden) {
                    // save audio preferences and mute
                    saveMuteSound = mutedSound;
                    saveMuteMusic = mutedMusic;
                    obj.muteMusic(true);
                    obj.muteSound(true);
                } else {
                    // reload audio preferences and replay music if necessary
                    mutedSound = saveMuteSound;
                    mutedMusic = saveMuteMusic;
                    obj.playMusic(lastMusicPlayed, musicLoop);
                }
            },
            obj = {
                /* Sets the volume (0 = minimum, 1 = maximum)
                 * @name setVolume
                 * @function
                 * @param {Number} value: the volume
                 * @param {String} name: name of the sound currently playing
                 */
                setVolume: function (value, name) {
                    assetManager.getAudio(name).volume(value);
                },
                /* Plays a sound
                 * @name playSound
                 * @function
                 * @param {String} name: name of the soundfile
                 */
                playSound: function (name) {
                    if (!mutedSound && !preventSounds) {
                        assetManager.getAudio(name).play();
                    }
                },
                stopSound: function (name) {
                    var i, l, node;
                    assetManager.getAudio(name).stop();
                },
                /* Plays a music
                 * @name playMusic
                 * @function
                 * @param {String} name: name of the soundfile
                 */
                playMusic: function (name, loop, onEnd, time) {
                    lastMusicPlayed = name;
                    if (Utils.isDefined(loop)) {
                        musicLoop = loop;
                    } else {
                        musicLoop = true;
                    }
                    // set end event
                    if (Utils.isCocoonJS() && onEnd) {
                        assetManager.getAudio(name)._audioNode[0].onended = onEnd;
                    }
                    if (!mutedMusic && lastMusicPlayed !== '') {
                        if (Utils.isCocoonJS()) {
                            assetManager.getAudio(name)._audioNode[0].currentTime = time || 0;
                            assetManager.getAudio(name)._audioNode[0].loop = musicLoop;
                            assetManager.getAudio(name)._audioNode[0].play();
                            return;
                        }
                        assetManager.getAudio(name).loop(musicLoop);
                        assetManager.getAudio(name).play(function (id) {
                            currentMusicId = id;
                        });
                    }
                },
                stopMusic: function (name) {
                    var i, l, node;
                    if (Utils.isCocoonJS()) {
                        assetManager.getAudio(name)._audioNode[0].pause();
                        return;
                    }
                    assetManager.getAudio(name).stop();
                },
                /* Mute or unmute all sound
                 * @name muteSound
                 * @function
                 * @param {Boolean} mute: whether to mute or not
                 */
                muteSound: function (mute) {
                    mutedSound = mute;
                    if (mutedSound) {
                        // we stop all sounds because setting volume is not supported on all devices
                        this.stopAllSound();
                    }
                },
                /* Mute or unmute all music
                 * @name muteMusic
                 * @function
                 * @param {Boolean} mute: whether to mute or not
                 */
                muteMusic: function (mute, continueMusic) {
                    var last = lastMusicPlayed;
                    mutedMusic = mute;

                    if (!Utils.isDefined(continueMusic)) {
                        continueMusic = false;
                    }
                    if (mutedMusic) {
                        obj.stopAllMusic();
                        lastMusicPlayed = last;
                    } else if (continueMusic && lastMusicPlayed !== '') {
                        obj.playMusic(lastMusicPlayed, musicLoop);
                    }
                },
                /* Stop all sound currently playing
                 * @name stopAllSound
                 * @function
                 */
                stopAllSound: function () {
                    var sound,
                        howls = assetManager.getAssets().audio;
                    for (sound in howls) {
                        if (howls.hasOwnProperty(sound) && sound.substring(0, 3) === 'sfx') {
                            howls[sound].stop();
                        }
                    }
                },
                /* Stop all sound currently playing
                 * @name stopAllSound
                 * @function
                 */
                stopAllMusic: function () {
                    var sound,
                        howls = assetManager.getAssets().audio;
                    for (sound in howls) {
                        if (howls.hasOwnProperty(sound) && sound.substring(0, 3) === 'bgm') {
                            if (Utils.isCocoonJS()) {
                                howls[sound]._audioNode[0].pause();
                                continue;
                            }
                            howls[sound].stop(sound === lastMusicPlayed ? currentMusicId : void(0));
                        }
                    }
                    lastMusicPlayed = '';
                },
                /* Prevents any sound from playing without interrupting current sounds
                 * @name preventSounds
                 * @function
                 */
                preventSounds: function (bool) {
                    preventSounds = bool;
                }
            };
        // https://developer.mozilla.org/en-US/docs/Web/Guide/User_experience/Using_the_Page_Visibility_API
        if ('hidden' in document) {
            document.addEventListener("visibilitychange", function () {
                onVisibilityChanged(document.hidden);
            }, false);
        } else if ('mozHidden' in document) {
            document.addEventListener("mozvisibilitychange", function () {
                onVisibilityChanged(document.mozHidden);
            }, false);
        } else if ('webkitHidden' in document) {
            document.addEventListener("webkitvisibilitychange", function () {
                onVisibilityChanged(document.webkitHidden);
            }, false);
        } else if ('msHidden' in document) {
            document.addEventListener("msvisibilitychange", function () {
                onVisibilityChanged(document.msHidden);
            }, false);
        } else if ('onpagehide' in window) {
            window.addEventListener('pagehide', function () {
                onVisibilityChanged(true);
            }, false);
            window.addEventListener('pageshow', function () {
                onVisibilityChanged(false);
            }, false);
        } else if ('onblur' in document) {
            window.addEventListener('blur', function () {
                onVisibilityChanged(true);
            }, false);
            window.addEventListener('focus', function () {
                onVisibilityChanged(false);
            }, false);
            visHandled = true;
        } else if ('onfocusout' in document) {
            window.addEventListener('focusout', function () {
                onVisibilityChanged(true);
            }, false);
            window.addEventListener('focusin', function () {
                onVisibilityChanged(false);
            }, false);
        }
        return obj;
    };
});
/**
 * Manager that tracks mouse/touch and keyboard input
 * <br>Exports: Function
 * @module bento/managers/input
 * @param {Object} settings - Settings
 * @param {Vector2} settings.canvasScale - Reference to the current canvas scale.
 * @param {HtmlCanvas} settings.canvas - Reference to the canvas element.
 * @param {Rectangle} settings.viewport - Reference to viewport.
 * @returns InputManager
 */
bento.define('bento/managers/input', [
    'bento/utils',
    'bento/math/vector2',
    'bento/eventsystem'
], function (Utils, Vector2, EventSystem) {
    'use strict';
    return function (settings) {
        var isPaused = false,
            isListening = false,
            canvas,
            canvasScale,
            viewport,
            pointers = [],
            keyStates = {},
            offsetLeft = 0,
            offsetTop = 0,
            pointerDown = function (evt) {
                pointers.push({
                    id: evt.id,
                    position: evt.position,
                    eventType: evt.eventType,
                    localPosition: evt.localPosition,
                    worldPosition: evt.worldPosition
                });
                EventSystem.fire('pointerDown', evt);
            },
            pointerMove = function (evt) {
                EventSystem.fire('pointerMove', evt);
                updatePointer(evt);
            },
            pointerUp = function (evt) {
                EventSystem.fire('pointerUp', evt);
                removePointer(evt);
            },
            touchStart = function (evt) {
                var id, i;
                evt.preventDefault();
                for (i = 0; i < evt.changedTouches.length; i += 1) {
                    addTouchPosition(evt, i, 'start');
                    pointerDown(evt);
                }
            },
            touchMove = function (evt) {
                var id, i;
                evt.preventDefault();
                for (i = 0; i < evt.changedTouches.length; i += 1) {
                    addTouchPosition(evt, i, 'move');
                    pointerMove(evt);
                }
            },
            touchEnd = function (evt) {
                var id, i;
                evt.preventDefault();
                for (i = 0; i < evt.changedTouches.length; i += 1) {
                    addTouchPosition(evt, i, 'end');
                    pointerUp(evt);
                }
            },
            mouseDown = function (evt) {
                evt.preventDefault();
                addMousePosition(evt);
                pointerDown(evt);
            },
            mouseMove = function (evt) {
                evt.preventDefault();
                addMousePosition(evt);
                pointerMove(evt);
            },
            mouseUp = function (evt) {
                evt.preventDefault();
                addMousePosition(evt);
                pointerUp(evt);
            },
            addTouchPosition = function (evt, n, type) {
                var touch = evt.changedTouches[n],
                    x = (touch.pageX - offsetLeft) / canvasScale.x,
                    y = (touch.pageY - offsetTop) / canvasScale.y;
                evt.preventDefault();
                evt.id = 0;
                evt.eventType = 'touch';
                evt.changedTouches[n].position = Vector2(x, y);
                evt.changedTouches[n].worldPosition = evt.changedTouches[n].position.clone();
                evt.changedTouches[n].worldPosition.x += viewport.x;
                evt.changedTouches[n].worldPosition.y += viewport.y;
                evt.changedTouches[n].localPosition = evt.changedTouches[n].position.clone();
                // add 'normal' position
                evt.position = evt.changedTouches[n].position.clone();
                evt.worldPosition = evt.changedTouches[n].worldPosition.clone();
                evt.localPosition = evt.changedTouches[n].position.clone();
                // id
                evt.id = evt.changedTouches[n].identifier + 1;
            },
            addMousePosition = function (evt) {
                var x = (evt.pageX - offsetLeft) / canvasScale.x,
                    y = (evt.pageY - offsetTop) / canvasScale.y;
                evt.id = 0;
                evt.eventType = 'mouse';
                evt.position = Vector2(x, y);
                evt.worldPosition = evt.position.clone();
                evt.worldPosition.x += viewport.x;
                evt.worldPosition.y += viewport.y;
                evt.localPosition = evt.position.clone();
                // give it an id that doesn't clash with touch id
                evt.id = -1;
            },
            updatePointer = function (evt) {
                var i = 0;
                for (i = 0; i < pointers.length; i += 1) {
                    if (pointers[i].id === evt.id) {
                        pointers[i].position = evt.position;
                        pointers[i].worldPosition = evt.worldPosition;
                        pointers[i].localPosition = evt.position;
                        return;
                    }
                }
            },
            removePointer = function (evt) {
                var i = 0;
                for (i = 0; i < pointers.length; i += 1) {
                    if (pointers[i].id === evt.id) {
                        pointers.splice(i, 1);
                        return;
                    }
                }
            },
            initTouch = function () {
                canvas.addEventListener('touchstart', touchStart);
                canvas.addEventListener('touchmove', touchMove);
                canvas.addEventListener('touchend', touchEnd);
                canvas.addEventListener('mousedown', mouseDown);
                canvas.addEventListener('mousemove', mouseMove);
                canvas.addEventListener('mouseup', mouseUp);
                isListening = true;

                document.body.addEventListener('touchstart', function (evt) {
                    if (evt && evt.preventDefault) {
                        evt.preventDefault();
                    }
                    if (evt && evt.stopPropagation) {
                        evt.stopPropagation();
                    }
                    return false;
                });
                document.body.addEventListener('touchmove', function (evt) {
                    if (evt && evt.preventDefault) {
                        evt.preventDefault();
                    }
                    if (evt && evt.stopPropagation) {
                        evt.stopPropagation();
                    }
                    return false;
                });
            },
            initKeyboard = function () {
                var element = settings.canvas || window,
                    refocus = function (evt) {
                        if (element.focus) {
                            element.focus();
                        }
                    };
                // fix for iframes
                element.tabIndex = 0;
                if (element.focus) {
                    element.focus();
                }
                element.addEventListener('keydown', keyDown, false);
                element.addEventListener('keyup', keyUp, false);
                // refocus
                element.addEventListener('mousedown', refocus, false);

            },
            keyDown = function (evt) {
                var i, names;
                evt.preventDefault();
                EventSystem.fire('keyDown', evt);
                // get names
                names = Utils.keyboardMapping[evt.keyCode];
                for (i = 0; i < names.length; ++i) {
                    keyStates[names[i]] = true;
                    EventSystem.fire('buttonDown', names[i]);
                }
            },
            keyUp = function (evt) {
                var i, names;
                evt.preventDefault();
                EventSystem.fire('keyUp', evt);
                // get names
                names = Utils.keyboardMapping[evt.keyCode];
                for (i = 0; i < names.length; ++i) {
                    keyStates[names[i]] = false;
                    EventSystem.fire('buttonUp', names[i]);
                }
            },
            destroy = function () {
                // remove all event listeners
            };

        if (!settings) {
            throw 'Supply a settings object';
        }
        // canvasScale is needed to take css scaling into account
        canvasScale = settings.canvasScale;
        canvas = settings.canvas;
        viewport = settings.viewport;

        if (canvas && !Utils.isCocoonJS()) {
            offsetLeft = canvas.offsetLeft;
            offsetTop = canvas.offsetTop;
        }

        // touch device
        initTouch();

        // keyboard
        initKeyboard();

        return {
            /**
             * Returns current pointers down
             * @function
             * @instance
             * @returns {Array} pointers - Array with pointer positions
             * @name getPointers
             */
            getPointers: function () {
                return pointers;
            },
            /**
             * Removes all current pointers down
             * @function
             * @instance
             * @returns {Array} pointers - Array with pointer positions
             * @name resetPointers
             */
            resetPointers: function () {
                pointers.length = 0;
            },
            /**
             * Checks if a keyboard key is down
             * @function
             * @instance
             * @param {String} name - name of the key
             * @name isKeyDown
             */
            isKeyDown: function (name) {
                return keyStates[name] || false;
            },
            /**
             * Stop all pointer input
             * @function
             * @instance
             * @name stop
             */
            stop: function () {
                if (!isListening) {
                    return;
                }
                canvas.removeEventListener('touchstart', touchStart);
                canvas.removeEventListener('touchmove', touchMove);
                canvas.removeEventListener('touchend', touchEnd);
                canvas.removeEventListener('mousedown', mouseDown);
                canvas.removeEventListener('mousemove', mouseMove);
                canvas.removeEventListener('mouseup', mouseUp);
                isListening = false;
            },
            /**
             * Resumes all pointer input
             * @function
             * @instance
             * @name resume
             */
            resume: function () {
                if (isListening) {
                    return;
                }
                canvas.addEventListener('touchstart', touchStart);
                canvas.addEventListener('touchmove', touchMove);
                canvas.addEventListener('touchend', touchEnd);
                canvas.addEventListener('mousedown', mouseDown);
                canvas.addEventListener('mousemove', mouseMove);
                canvas.addEventListener('mouseup', mouseUp);
                isListening = true;
            }
        };
    };
});
/**
 * Manager that controls mainloop and all objects
 * <br>Exports: Function
 * @module bento/managers/object
 * @param {Object} data - gameData object
 * @param {Object} settings - Settings object
 * @param {Object} settings.defaultSort - Use javascript default sorting (not recommended)
 * @param {Object} settings.debug - Show debug info
 * @param {Object} settings.useDeltaT - Use delta time (untested)
 * @returns ObjectManager
 */
bento.define('bento/managers/object', [
    'hshg',
    'bento/utils'
], function (Hshg, Utils) {
    'use strict';
    return function (data, settings) {
        var objects = [],
            lastTime = new Date().getTime(),
            cumulativeTime = 0,
            minimumFps = 30,
            lastFrameTime = new Date().getTime(),
            gameData,
            quickAccess = {},
            isRunning = false,
            useSort = true,
            isPaused = false,
            isStopped = false,
            fpsMeter,
            hshg = new Hshg(),
            sort = function () {
                if (!settings.defaultSort) {
                    Utils.stableSort.inplace(objects, function (a, b) {
                        return a.z - b.z;
                    });
                } else {
                    // default behavior
                    objects.sort(function (a, b) {
                        return a.z - b.z;
                    });
                }
            },
            cleanObjects = function () {
                var i;
                // loop objects array from end to start and remove null elements
                for (i = objects.length - 1; i >= 0; --i) {
                    if (objects[i] === null) {
                        objects.splice(i, 1);
                    }
                }
            },
            mainLoop = function (time) {
                var object,
                    i,
                    currentTime = new Date().getTime(),
                    deltaT = currentTime - lastTime;

                if (!isRunning) {
                    return;
                }

                if (settings.debug && fpsMeter) {
                    fpsMeter.tickStart();
                }

                lastTime = currentTime;
                cumulativeTime += deltaT;
                gameData.deltaT = deltaT;
                if (settings.useDeltaT) {
                    cumulativeTime = 1000 / 60;
                }
                while (cumulativeTime >= 1000 / 60) {
                    cumulativeTime -= 1000 / 60;
                    if (cumulativeTime > 1000 / minimumFps) {
                        // deplete cumulative time
                        while (cumulativeTime >= 1000 / 60) {
                            cumulativeTime -= 1000 / 60;
                        }
                    }
                    if (settings.useDeltaT) {
                        cumulativeTime = 0;
                    }
                    update();
                }
                cleanObjects();
                if (useSort) {
                    sort();
                }
                draw();

                lastFrameTime = time;
                if (settings.debug && fpsMeter) {
                    fpsMeter.tick();
                }

                requestAnimationFrame(mainLoop);
            },
            update = function () {
                var object,
                    i;
                if (!isPaused) {
                    hshg.update();
                    hshg.queryForCollisionPairs();
                }
                for (i = 0; i < objects.length; ++i) {
                    object = objects[i];
                    if (!object) {
                        continue;
                    }
                    if (object.update && ((isPaused && object.updateWhenPaused) || !isPaused)) {
                        object.update(gameData);
                    }
                }
            },
            draw = function () {
                var object,
                    i;
                gameData.renderer.begin();
                for (i = 0; i < objects.length; ++i) {
                    object = objects[i];
                    if (!object) {
                        continue;
                    }
                    if (object.draw) {
                        object.draw(gameData);
                    }
                }
                gameData.renderer.flush();
            },
            attach = function (object) {
                var i, type, family;
                object.z = object.z || 0;
                objects.push(object);
                if (object.init) {
                    object.init();
                }
                if (object.start) {
                    object.start(gameData);
                }
                object.isAdded = true;
                if (object.useHshg && object.getAABB) {
                    hshg.addObject(object);
                }
                // add object to access pools
                if (object.getFamily) {
                    family = object.getFamily();
                    for (i = 0; i < family.length; ++i) {
                        type = family[i];
                        if (!quickAccess[type]) {
                            quickAccess[type] = [];
                        }
                        quickAccess[type].push(object);
                    }
                }
            },
            module = {
                /**
                 * Adds entity/object to the game. If the object has the
                 * functions update and draw, they will be called in the loop.
                 * @function
                 * @instance
                 * @param {Object} object - You can add any object, preferably an Entity
                 * @name attach
                 */
                attach: attach,
                add: attach,
                /**
                 * Removes entity/object
                 * @function
                 * @instance
                 * @param {Object} object - Reference to the object to be removed
                 * @name remove
                 */
                remove: function (object) {
                    var i, type, index, family;
                    if (!object) {
                        return;
                    }
                    index = objects.indexOf(object);
                    if (index >= 0) {
                        objects[index] = null;
                        if (object.destroy) {
                            object.destroy(gameData);
                        }
                        object.isAdded = false;
                    }
                    if (object.useHshg && object.getAABB) {
                        hshg.removeObject(object);
                    }
                    // remove from access pools
                    if (object.getFamily) {
                        family = object.getFamily();
                        for (i = 0; i < family.length; ++i) {
                            type = family[i];
                            Utils.removeObject(quickAccess[type], object);
                        }
                    }
                },
                /**
                 * Removes all entities/objects except ones that have the property "global"
                 * @function
                 * @instance
                 * @param {Boolean} removeGlobal - Also remove global objects
                 * @name removeAll
                 */
                removeAll: function (removeGlobal) {
                    var i,
                        object;
                    for (i = 0; i < objects.length; ++i) {
                        object = objects[i];
                        if (!object) {
                            continue;
                        }
                        if (!object.global || removeGlobal) {
                            module.remove(object);
                        }
                    }
                },
                /**
                 * Returns the first object it can find with this name
                 * @function
                 * @instance
                 * @param {String} objectName - Name of the object
                 * @param {Function} [callback] - Called if the object is found
                 * @returns {Object} null if not found
                 * @name get
                 */
                get: function (objectName, callback) {
                    // retrieves the first object it finds by its name
                    var i,
                        object;

                    for (i = 0; i < objects.length; ++i) {
                        object = objects[i];
                        if (!object) {
                            continue;
                        }
                        if (!object.name) {
                            continue;
                        }
                        if (object.name === objectName) {
                            if (callback) {
                                callback(object);
                            }
                            return object;
                        }
                    }
                    return null;
                },
                /**
                 * Returns an array of objects with a certain name
                 * @function
                 * @instance
                 * @param {String} objectName - Name of the object
                 * @param {Function} [callback] - Called with the object array
                 * @returns {Array} An array of objects, empty if no objects found
                 * @name getByName
                 */
                getByName: function (objectName, callback) {
                    var i,
                        object,
                        array = [];

                    for (i = 0; i < objects.length; ++i) {
                        object = objects[i];
                        if (!object) {
                            continue;
                        }
                        if (!object.name) {
                            continue;
                        }
                        if (object.name === objectName) {
                            array.push(object);
                        }
                    }
                    if (callback && array.length) {
                        callback(array);
                    }
                    return array;
                },
                /**
                 * Returns an array of objects by family name
                 * @function
                 * @instance
                 * @param {String} familyName - Name of the family
                 * @param {Function} [callback] - Called with the object array
                 * @returns {Array} An array of objects, empty if no objects found
                 * @name getByFamily
                 */
                getByFamily: function (type, callback) {
                    var array = quickAccess[type];
                    if (!array) {
                        // initialize it
                        quickAccess[type] = [];
                        array = quickAccess[type];
                        console.log('Warning: family called ' + type + ' does not exist');
                    }
                    if (callback && array.length) {
                        callback(array);
                    }
                    return array;
                },
                /**
                 * Stops the mainloop
                 * @function
                 * @instance
                 * @name stop
                 */
                stop: function () {
                    isRunning = false;
                },
                /**
                 * Starts the mainloop
                 * @function
                 * @instance
                 * @name run
                 */
                run: function () {
                    if (!isRunning) {
                        isRunning = true;
                        mainLoop();
                    }
                },
                /**
                 * Returns the number of objects
                 * @function
                 * @instance
                 * @returns {Number} The number of objects
                 * @name count
                 */
                count: function () {
                    return objects.length;
                },
                /**
                 * Stops calling update on every object. Note that draw is still
                 * being called. Objects with the property updateWhenPaused
                 * will still be updated.
                 * @function
                 * @instance
                 * @name pause
                 */
                pause: function () {
                    isPaused = true;
                },
                /**
                 * Cancels the pause and resume updating objects.
                 * @function
                 * @instance
                 * @name resume
                 */
                resume: function () {
                    isPaused = false;
                },
                /**
                 * Returns true if paused
                 * @function
                 * @instance
                 * @name isPaused
                 */
                isPaused: function () {
                    return isPaused;
                },
                /**
                 * Forces objects to be drawn (Don't call this unless you need it)
                 * @function
                 * @instance
                 * @name draw
                 */
                draw: function () {
                    draw();
                }
            };

        if (!window.performance) {
            window.performance = {
                now: Date.now
            };
        }
        gameData = data;
        if (settings.debug && Utils.isDefined(window.FPSMeter)) {
            FPSMeter.defaults.graph = 1;
            fpsMeter = new FPSMeter();
        }

        return module;
    };
});
/**
 * Manager that controls presistent variables. Wrapper for localStorage.
 * <br>Exports: Object
 * @module bento/managers/savestate
 * @returns SaveState
 */
bento.define('bento/managers/savestate', [
    'bento/utils'
], function (Utils) {
    'use strict';
    var uniqueID = document.URL,
        storage,
        storageFallBack = {
            setItem: function (key, value) {
                var k,
                    count = 0;
                storageFallBack[key] = value;
                // update length
                for (k in storageFallBack) {
                    if (storageFallBack.hasOwnProperty(k)) {
                        ++count;
                    }
                }
                this.length = count;
            },
            getItem: function (key) {
                var item = storageFallBack[key];
                return Utils.isDefined(item) ? item : null;
            },
            removeItem: function (key) {
                delete storageFallBack[key];
            },
            clear: function () {
                this.length = 0;
            },
            length: 0
        };

    // initialize
    try {
        storage = window.localStorage;
        // try saving once
        if (window.localStorage) {
            window.localStorage.setItem(uniqueID + 'save', '0');
        } else {
            throw 'No local storage available';
        }
    } catch (e) {
        console.log('Warning: you have disabled cookies on your browser. You cannot save progress in your game.');
        storage = storageFallBack;
    }
    return {
        /**
         * Saves/serializes a variable
         * @function
         * @instance
         * @param {String} key - Name of the variable
         * @param {Object} value - Number/Object/Array to be saved
         * @name save
         */
        save: function (elementKey, element) {
            if (typeof elementKey !== 'string') {
                elementKey = JSON.stringify(elementKey);
            }
            storage.setItem(uniqueID + elementKey, JSON.stringify(element));
        },
        /**
         * Loads a variable
         * @function
         * @instance
         * @param {String} key - Name of the variable
         * @param {Object} defaultValue - The value returns if saved variable doesn't exists
         * @returns {Object} Returns saved value, otherwise defaultValue
         * @name load
         */
        load: function (elementKey, defaultValue) {
            var element;
            element = storage.getItem(uniqueID + elementKey);
            if (element === null) {
                return defaultValue;
            }
            return JSON.parse(element);
        },
        /**
         * Deletes a variable
         * @function
         * @instance
         * @param {String} key - Name of the variable
         * @name remove
         */
        remove: function (elementKey) {
            storage.removeItem(uniqueID + elementKey);
        },
        /**
         * Clears the savestate
         * @function
         * @instance
         * @name clear
         */
        clear: function () {
            storage.clear();
        },
        debug: function () {
            console.log(localStorage);
        },
        /**
         * Checks if localStorage has values
         * @function
         * @instance
         * @name isEmpty
         */
        isEmpty: function () {
            return storage.length === 0;
        },
        /**
         * Sets an identifier that's prepended on every key.
         * By default this is the URL, to prevend savefile clashing.
         * TODO: better if its the game name
         * @function
         * @instance
         * @param {String} name - ID name
         * @name setId
         */
        setId: function (str) {
            uniqueID = str;
        }
    };
});
/**
 * Manager that controls screens/rooms/levels.
 * <br>Exports: Function
 * @module bento/managers/screen
 * @returns ScreenManager
 */
bento.define('bento/managers/screen', [
    'bento/utils'
], function (Utils) {
    'use strict';
    return function () {
        var screens = {},
            currentScreen = null,
            getScreen = function (name) {
                return screens[name];
            },
            screenManager = {
                /**
                 * Adds a new screen
                 * @function
                 * @instance
                 * @param {Screen} screen - Screen object
                 * @name add
                 */
                add: function (screen) {
                    if (!screen.name) {
                        throw 'Add name property to screen';
                    }
                    screens[screen.name] = screen;
                },
                /**
                 * Shows a screen. If the screen was not added previously, it
                 * will be loaded asynchronously by a require call.
                 * @function
                 * @instance
                 * @param {String} name - Name of the screen
                 * @param {Object} data - Extra data to pass on to the screen
                 * @param {Function} callback - Called when screen is shown
                 * @name show
                 */
                show: function (name, data, callback) {
                    if (currentScreen !== null) {
                        screenManager.hide();
                    }
                    currentScreen = screens[name];
                    if (currentScreen) {
                        if (currentScreen.onShow) {
                            currentScreen.onShow(data);
                        }
                        if (callback) {
                            callback();
                        }
                    } else {
                        // load asynchronously
                        bento.require([name], function (screenObj) {
                            if (!screenObj.name) {
                                screenObj.name = name;
                            }
                            screenManager.add(screenObj);
                            // try again
                            screenManager.show(name, data, callback);
                        });
                    }
                },
                /**
                 * Hides a screen. It's not needed to call this yourself.
                 * Screens are hidden when a new one is shown.
                 * @function
                 * @instance
                 * @param {Object} data - Extra data to pass on to the screen
                 * @name hide
                 */
                hide: function (data) {
                    if (!currentScreen) {
                        return;
                    }
                    currentScreen.onHide(data);
                    currentScreen = null;
                },
                /**
                 * Retuyrn reference to the screen currently shown.
                 * @function
                 * @instance
                 * @returns {Screen} The current screen
                 * @name getCurrentScreen
                 */
                getCurrentScreen: function () {
                    return currentScreen;
                }
            };

        return screenManager;

    };
});
/**
 * A 2-dimensional array
 * <br>Exports: Function
 * @module bento/math/array2d
 * @param {Number} width - horizontal size of array
 * @param {Number} height - vertical size of array
 * @returns {Array} Returns 2d array.
 */
bento.define('bento/math/array2d', function () {
    'use strict';
    return function (width, height) {
        var array = [],
            i,
            j;

        // init array
        for (i = 0; i < width; ++i) {
            array[i] = [];
            for (j = 0; j < height; ++j) {
                array[i][j] = null;
            }
        }

        return {
            /**
             * Returns true
             * @function
             * @returns {Boolean} Is always true
             * @instance
             * @name isArray2d
             */
            isArray2d: function () {
                return true;
            },
            /**
             * Callback at every iteration.
             *
             * @callback IterationCallBack
             * @param {Number} x - The current x index
             * @param {Number} y - The current y index
             * @param {Number} value - The value at the x,y index
             */
            /**
             * Iterate through 2d array
             * @function
             * @param {IterationCallback} callback - Callback function to be called every iteration
             * @instance
             * @name iterate
             */
            iterate: function (callback) {
                var i, j;
                for (j = 0; j < height; ++j) {
                    for (i = 0; i < width; ++i) {
                        callback(i, j, array[i][j]);
                    }
                }
            },
            /**
             * Get the value inside array
             * @function
             * @param {Number} x - x index
             * @param {Number} y - y index
             * @returns {Object} The value at the index
             * @instance
             * @name get
             */
            get: function (x, y) {
                return array[x][y];
            },
            /**
             * Set the value inside array
             * @function
             * @param {Number} x - x index
             * @param {Number} y - y index
             * @param {Number} value - new value
             * @instance
             * @name set
             */
            set: function (x, y, value) {
                array[x][y] = value;
            }
        };
    };
});
/**
 * Matrix
 * <br>Exports: Function
 * @module bento/math/matrix
 * @param {Number} width - horizontal size of matrix
 * @param {Number} height - vertical size of matrix
 * @returns {Matrix} Returns a matrix object.
 */
bento.define('bento/math/matrix', [
    'bento/utils'
], function (Utils) {
    'use strict';
    var add = function (other) {
            var newMatrix = this.clone();
            newMatrix.addTo(other);
            return newMatrix;
        },
        multiply = function (matrix1, matrix2) {
            var newMatrix = this.clone();
            newMatrix.multiplyWith(other);
            return newMatrix;
        },
        module = function (width, height) {
            var matrix = [],
                n = width || 0,
                m = height || 0,
                i,
                j,
                set = function (x, y, value) {
                    matrix[y * n + x] = value;
                },
                get = function (x, y) {
                    return matrix[y * n + x];
                };

            // initialize as identity matrix
            for (j = 0; j < m; ++j) {
                for (i = 0; i < n; ++i) {
                    if (i === j) {
                        set(i, j, 1);
                    } else {
                        set(i, j, 0);
                    }
                }
            }

            return {
                /**
                 * Returns true
                 * @function
                 * @returns {Boolean} Is always true
                 * @instance
                 * @name isMatrix
                 */
                isMatrix: function () {
                    return true;
                },
                /**
                 * Returns a string representation of the matrix (useful for debugging purposes)
                 * @function
                 * @returns {String} String matrix
                 * @instance
                 * @name stringify
                 */
                stringify: function () {
                    var i,
                        j,
                        str = '',
                        row = '';
                    for (j = 0; j < m; ++j) {
                        for (i = 0; i < n; ++i) {
                            row += get(i, j) + '\t';
                        }
                        str += row + '\n';
                        row = '';
                    }
                    return str;
                },
                /**
                 * Get the value inside matrix
                 * @function
                 * @param {Number} x - x index
                 * @param {Number} y - y index
                 * @returns {Number} The value at the index
                 * @instance
                 * @name get
                 */
                get: function (x, y) {
                    return get(x, y);
                },
                /**
                 * Set the value inside matrix
                 * @function
                 * @param {Number} x - x index
                 * @param {Number} y - y index
                 * @param {Number} value - new value
                 * @instance
                 * @name set
                 */
                set: function (x, y, value) {
                    set(x, y, value);
                },
                /**
                 * Set the values inside matrix using an array.
                 * If the matrix is 2x2 in size, then supplying an array with
                 * values [1, 2, 3, 4] will result in a matrix
                 * <br>[1 2]
                 * <br>[3 4]
                 * <br>If the array has more elements than the matrix, the
                 * rest of the array is ignored.
                 * @function
                 * @param {Array} array - array with Numbers
                 * @returns {Matrix} Returns self
                 * @instance
                 * @name setValues
                 */
                setValues: function (array) {
                    var i, l = Math.min(matrix.length, array.length);
                    for (i = 0; i < l; ++i) {
                        matrix[i] = array[i];
                    }
                    return this;
                },
                /**
                 * Get the matrix width
                 * @function
                 * @returns {Number} The width of the matrix
                 * @instance
                 * @name getWidth
                 */
                getWidth: function () {
                    return n;
                },
                /**
                 * Get the matrix height
                 * @function
                 * @returns {Number} The height of the matrix
                 * @instance
                 * @name getHeight
                 */
                getHeight: function () {
                    return m;
                },
                /**
                 * Callback at every iteration.
                 *
                 * @callback IterationCallBack
                 * @param {Number} x - The current x index
                 * @param {Number} y - The current y index
                 * @param {Number} value - The value at the x,y index
                 */
                /**
                 * Iterate through matrix
                 * @function
                 * @param {IterationCallback} callback - Callback function to be called every iteration
                 * @instance
                 * @name iterate
                 */
                iterate: function (callback) {
                    var i, j;
                    for (j = 0; j < m; ++j) {
                        for (i = 0; i < n; ++i) {
                            if (!Utils.isFunction(callback)) {
                                throw ('Please supply a callback function');
                            }
                            callback(i, j, get(i, j));
                        }
                    }
                },
                /**
                 * Transposes the current matrix
                 * @function
                 * @returns {Matrix} Returns self
                 * @instance
                 * @name transpose
                 */
                transpose: function () {
                    var i, j, newMat = [];
                    // reverse loop so m becomes n
                    for (i = 0; i < n; ++i) {
                        for (j = 0; j < m; ++j) {
                            newMat[i * m + j] = get(i, j);
                        }
                    }
                    // set new matrix
                    matrix = newMat;
                    // swap width and height
                    m = [n, n = m][0];
                    return this;
                },
                /**
                 * Addition of another matrix
                 * @function
                 * @param {Matrix} matrix - matrix to add
                 * @returns {Matrix} Updated matrix
                 * @instance
                 * @name addTo
                 */
                addTo: function (other) {
                    var i, j;
                    if (m != other.getHeight() || n != other.getWidth()) {
                        throw 'Matrix sizes incorrect';
                    }
                    for (j = 0; j < m; ++j) {
                        for (i = 0; i < n; ++i) {
                            set(i, j, get(i, j) + other.get(i, j));
                        }
                    }
                    return this;
                },
                /**
                 * Addition of another matrix
                 * @function
                 * @param {Matrix} matrix - matrix to add
                 * @returns {Matrix} A new matrix
                 * @instance
                 * @name add
                 */
                add: add,
                /**
                 * Multiply with another matrix
                 * If a new matrix C is the result of A * B = C
                 * then B is the current matrix and becomes C, A is the input matrix
                 * @function
                 * @param {Matrix} matrix - input matrix to multiply with
                 * @returns {Matrix} Updated matrix
                 * @instance
                 * @name multiplyWith
                 */
                multiplyWith: function (other) {
                    var i, j,
                        newMat = [],
                        newWidth = n, // B.n
                        oldHeight = m, // B.m
                        newHeight = other.getHeight(), // A.m
                        oldWidth = other.getWidth(), // A.n
                        newValue = 0,
                        k;
                    if (oldHeight != oldWidth) {
                        throw 'Matrix sizes incorrect';
                    }

                    for (j = 0; j < newHeight; ++j) {
                        for (i = 0; i < newWidth; ++i) {
                            newValue = 0;
                            // loop through matbentos
                            for (k = 0; k < oldWidth; ++k) {
                                newValue += other.get(k, j) * get(i, k);
                            }
                            newMat[j * newWidth + i] = newValue;
                        }
                    }
                    // set to new matrix
                    matrix = newMat;
                    // update matrix size
                    n = newWidth;
                    m = newHeight;
                    return this;
                },
                /**
                 * Multiply with another matrix
                 * If a new matrix C is the result of A * B = C
                 * then B is the current matrix and becomes C, A is the input matrix
                 * @function
                 * @param {Matrix} matrix - input matrix to multiply with
                 * @returns {Matrix} A new matrix
                 * @instance
                 * @name multiply
                 */
                multiply: multiply,
                /**
                 * Returns a clone of the current matrix
                 * @function
                 * @returns {Matrix} A new matrix
                 * @instance
                 * @name clone
                 */
                clone: function () {
                    var newMatrix = module(n, m);
                    newMatrix.setValues(matrix);
                    return newMatrix;
                }
            };
        };
    return module;
});
/**
 * Polygon
 * <br>Exports: Function
 * @module bento/math/polygon
 * @param {Array} points - An array of Vector2 with positions of all points
 * @returns {Polygon} Returns a polygon.
 */
bento.define('bento/math/polygon', [
    'bento/utils',
    'bento/math/rectangle'
], function (Utils, Rectangle) {
    'use strict';
    var isPolygon = function () {
            return true;
        },
        clone = function () {
            var clone = [],
                points = this.points,
                i = points.length;
            // clone the array
            while (i--) {
                clone[i] = points[i];
            }
            return module(clone);
        },
        offset = function (pos) {
            var clone = [],
                points = this.points,
                i = points.length;
            while (i--) {
                clone[i] = points[i];
                clone[i].x += pos.x;
                clone[i].y += pos.y;
            }
            return module(clone);
        },
        doLineSegmentsIntersect = function (p, p2, q, q2) {
            // based on https://github.com/pgkelley4/line-segments-intersect
            var crossProduct = function (p1, p2) {
                    return p1.x * p2.y - p1.y * p2.x;
                },
                subtractPoints = function (p1, p2) {
                    return {
                        x: p1.x - p2.x,
                        y: p1.y - p2.y
                    };
                },
                r = subtractPoints(p2, p),
                s = subtractPoints(q2, q),
                uNumerator = crossProduct(subtractPoints(q, p), r),
                denominator = crossProduct(r, s),
                u,
                t;
            if (uNumerator === 0 && denominator === 0) {
                return ((q.x - p.x < 0) !== (q.x - p2.x < 0) !== (q2.x - p.x < 0) !== (q2.x - p2.x < 0)) ||
                    ((q.y - p.y < 0) !== (q.y - p2.y < 0) !== (q2.y - p.y < 0) !== (q2.y - p2.y < 0));
            }
            if (denominator === 0) {
                return false;
            }
            u = uNumerator / denominator;
            t = crossProduct(subtractPoints(q, p), s) / denominator;
            return (t >= 0) && (t <= 1) && (u >= 0) && (u <= 1);
        },
        intersect = function (polygon) {
            var intersect = false,
                other = [],
                points = this.points,
                p1,
                p2,
                q1,
                q2,
                i,
                j;

            // is other really a polygon?
            if (polygon.isRectangle) {
                // before constructing a polygon, check if boxes collide in the first place 
                if (!this.getBoundingBox().intersect(polygon)) {
                    return false;
                }
                // construct a polygon out of rectangle
                other.push({
                    x: polygon.x,
                    y: polygon.y
                });
                other.push({
                    x: polygon.getX2(),
                    y: polygon.y
                });
                other.push({
                    x: polygon.getX2(),
                    y: polygon.getY2()
                });
                other.push({
                    x: polygon.x,
                    y: polygon.getY2()
                });
                polygon = module(other);
            } else {
                // simplest check first: regard polygons as boxes and check collision
                if (!this.getBoundingBox().intersect(polygon.getBoundingBox())) {
                    return false;
                }
                // get polygon points
                other = polygon.points;
            }

            // precision check
            for (i = 0; i < points.length; ++i) {
                for (j = 0; j < other.length; ++j) {
                    p1 = points[i];
                    p2 = points[(i + 1) % points.length];
                    q1 = other[j];
                    q2 = other[(j + 1) % other.length];
                    if (doLineSegmentsIntersect(p1, p2, q1, q2)) {
                        return true;
                    }
                }
            }
            // check inside one or another
            if (this.hasPosition(other[0]) || polygon.hasPosition(points[0])) {
                return true;
            } else {
                return false;
            }
        },
        hasPosition = function (p) {
            var points = this.points,
                has = false,
                i = 0,
                j = points.length - 1,
                bounds = this.getBoundingBox();

            if (p.x < bounds.x || p.x > bounds.x + bounds.width || p.y < bounds.y || p.y > bounds.y + bounds.height) {
                return false;
            }
            for (i, j; i < points.length; j = i++) {
                if ((points[i].y > p.y) != (points[j].y > p.y) &&
                    p.x < (points[j].x - points[i].x) * (p.y - points[i].y) /
                    (points[j].y - points[i].y) + points[i].x) {
                    has = !has;
                }
            }
            return has;
        },
        module = function (points) {
            var minX = points[0].x,
                maxX = points[0].x,
                minY = points[0].y,
                maxY = points[0].y,
                n = 1,
                q;

            for (n = 1; n < points.length; ++n) {
                q = points[n];
                minX = Math.min(q.x, minX);
                maxX = Math.max(q.x, maxX);
                minY = Math.min(q.y, minY);
                maxY = Math.max(q.y, maxY);
            }

            return {
                // TODO: use x and y as offset, widht and height as boundingbox
                x: minX, 
                y: minY, 
                width: maxX - minX, 
                height: maxY - minY,
                /**
                 * Array of Vector2 points
                 * @instance
                 * @name points
                 */
                points: points,
                /**
                 * Returns true
                 * @function
                 * @returns {Boolean} Is always true
                 * @instance
                 * @name isPolygon
                 */
                isPolygon: isPolygon,
                /**
                 * Get the rectangle containing the polygon
                 * @function
                 * @returns {Rectangle} Rectangle containing the polygon
                 * @instance
                 * @name getBoundingBox
                 */
                getBoundingBox: function () {
                    return Rectangle(minX, minY, maxX - minX, maxY - minY);
                },
                /**
                 * Checks if Vector2 lies within the polygon
                 * @function
                 * @returns {Boolean} true if position is inside
                 * @instance
                 * @name hasPosition
                 */
                hasPosition: hasPosition,
                /**
                 * Checks if other polygon/rectangle overlaps.
                 * Note that this may be computationally expensive. 
                 * @function
                 * @param {Polygon/Rectangle} other - Other polygon or rectangle
                 * @returns {Boolean} true if polygons overlap
                 * @instance
                 * @name intersect
                 */
                intersect: intersect,
                /**
                 * Moves polygon by an offset
                 * @function
                 * @param {Vector2} vector - Position to offset
                 * @returns {Polygon} Returns a new polygon instance
                 * @instance
                 * @name offset
                 */
                offset: offset,
                /**
                 * Clones polygon
                 * @function
                 * @returns {Polygon} a clone of the current polygon
                 * @instance
                 * @name clone
                 */
                clone: clone
            };
        };
    return module;
});
/**
 * Rectangle
 * <br>Exports: Function
 * @module bento/math/rectangle
 * @param {Number} x - Top left x position
 * @param {Number} y - Top left y position
 * @param {Number} width - Width of the rectangle
 * @param {Number} height - Height of the rectangle
 * @returns {Rectangle} Returns a rectangle.
 */
bento.define('bento/math/rectangle', ['bento/utils'], function (Utils) {
    'use strict';
    var isRectangle = function () {
            return true;
        },
        getX2 = function () {
            return this.x + this.width;
        },
        getY2 = function () {
            return this.y + this.height;
        },
        union = function (rectangle) {
            var x1 = Math.min(this.x, rectangle.x),
                y1 = Math.min(this.y, rectangle.y),
                x2 = Math.max(this.getX2(), rectangle.getX2()),
                y2 = Math.max(this.getY2(), rectangle.getY2());
            return module(x1, y1, x2 - x1, y2 - y1);
        },
        intersect = function (other) {
            if (other.isPolygon) {
                return other.intersect(this);
            } else {
                return !(this.x + this.width <= other.x ||
                    this.y + this.height <= other.y ||
                    this.x >= other.x + other.width ||
                    this.y >= other.y + other.height);
            }
        },
        intersection = function (rectangle) {
            var inter = module(0, 0, 0, 0);
            if (this.intersect(rectangle)) {
                inter.x = Math.max(this.x, rectangle.x);
                inter.y = Math.max(this.y, rectangle.y);
                inter.width = Math.min(this.x + this.width, rectangle.x + rectangle.width) - inter.x;
                inter.height = Math.min(this.y + this.height, rectangle.y + rectangle.height) - inter.y;
            }
            return inter;
        },
        offset = function (pos) {
            return module(this.x + pos.x, this.y + pos.y, this.width, this.height);
        },
        clone = function () {
            return module(this.x, this.y, this.width, this.height);
        },
        hasPosition = function (vector) {
            return !(
                vector.x < this.x ||
                vector.y < this.y ||
                vector.x >= this.x + this.width ||
                vector.y >= this.y + this.height
            );
        },
        grow = function (size) {
            this.x -= size / 2;
            this.y -= size / 2;
            this.width += size;
            this.height += size;
        },
        module = function (x, y, width, height) {
            return {
                /**
                 * X position
                 * @instance
                 * @name x
                 */
                x: x,
                /**
                 * Y position
                 * @instance
                 * @name y
                 */
                y: y,
                /**
                 * Width of the rectangle
                 * @instance
                 * @name width
                 */
                width: width,
                /**
                 * Height of the rectangle
                 * @instance
                 * @name height
                 */
                height: height,
                /**
                 * Returns true
                 * @function
                 * @returns {Boolean} Is always true
                 * @instance
                 * @name isRectangle
                 */
                isRectangle: isRectangle,
                /**
                 * Gets the lower right x position
                 * @function
                 * @returns {Number} Coordinate of the lower right position
                 * @instance
                 * @name getX2
                 */
                getX2: getX2,
                /**
                 * Gets the lower right y position
                 * @function
                 * @returns {Number} Coordinate of the lower right position
                 * @instance
                 * @name getY2
                 */
                getY2: getY2,
                /**
                 * Returns the union of 2 rectangles
                 * @function
                 * @param {Rectangle} other - Other rectangle
                 * @returns {Rectangle} Union of the 2 rectangles
                 * @instance
                 * @name union
                 */
                union: union,
                /**
                 * Returns true if 2 rectangles intersect
                 * @function
                 * @param {Rectangle} other - Other rectangle
                 * @returns {Boolean} True of 2 rectangles intersect
                 * @instance
                 * @name union
                 */
                intersect: intersect,
                /**
                 * Returns the intersection of 2 rectangles
                 * @function
                 * @param {Rectangle} other - Other rectangle
                 * @returns {Rectangle} Intersection of the 2 rectangles
                 * @instance
                 * @name union
                 */
                intersection: intersection,
                /**
                 * Moves rectangle by an offset
                 * @function
                 * @param {Vector2} vector - Position to offset
                 * @returns {Rectangle} Returns a new rectangle instance
                 * @instance
                 * @name offset
                 */
                offset: offset,
                /**
                 * Clones rectangle
                 * @function
                 * @returns {Rectangle} a clone of the current rectangle
                 * @instance
                 * @name clone
                 */
                clone: clone,
                /**
                 * Checks if Vector2 lies within the rectangle
                 * @function
                 * @returns {Boolean} true if position is inside
                 * @instance
                 * @name hasPosition
                 */
                hasPosition: hasPosition,
                /**
                 * Increases rectangle size from the center
                 * @function
                 * @returns {Number} value to grow the rectangle
                 * @instance
                 * @name grow
                 */
                grow: grow
            };
        };
    return module;
});
/**
 * 2 dimensional vector
 * (Note: to perform matrix multiplications, one must use toMatrix)
 * <br>Exports: Function
 * @module bento/math/vector2
 * @param {Number} x - x position
 * @param {Number} y - y position
 * @returns {Vector2} Returns a 2d vector.
 */
bento.define('bento/math/vector2', ['bento/math/matrix'], function (Matrix) {
    'use strict';
    var isVector2 = function () {
            return true;
        },
        add = function (vector) {
            var v = this.clone();
            v.addTo(vector);
            return v;
        },
        addTo = function (vector) {
            this.x += vector.x;
            this.y += vector.y;
            return this;
        },
        substract = function (vector) {
            var v = this.clone();
            v.substractFrom(vector);
            return v;
        },
        substractFrom = function (vector) {
            this.x -= vector.x;
            this.y -= vector.y;
            return this;
        },
        angle = function () {
            return Math.atan2(this.y, this.x);
        },
        angleBetween = function (vector) {
            return Math.atan2(
                vector.y - this.y,
                vector.x - this.x
            );
        },
        dotProduct = function (vector) {
            return this.x * vector.x + this.y * vector.y;
        },
        multiply = function (vector) {
            var v = this.clone();
            v.multiplyWith(vector);
            return v;
        },
        multiplyWith = function (vector) {
            this.x *= vector.x;
            this.y *= vector.y;
            return this;
        },
        divide = function (vector) {
            var v = this.clone();
            v.divideBy(vector);
            return v;
        },
        divideBy = function (vector) {
            this.x /= vector.x;
            this.y /= vector.y;
            return this;
        },
        scalarMultiply = function (value) {
            var v = this.clone();
            v.scalarMultiplyWith(value);
            return v;
        },
        scalarMultiplyWith = function (value) {
            this.x *= value;
            this.y *= value;
            return this;
        },
        scale = function (value) {
            this.x *= value;
            this.y *= value;
            return this;
        },
        length = function () {
            return Math.sqrt(this.dotProduct(this));
        },
        normalize = function () {
            var length = this.length();
            this.x /= length;
            this.y /= length;
            return this;
        },
        distance = function (vector) {
            return vector.substract(this).length();
        },
        rotateRadian = function (angle) {
            var x = this.x * Math.cos(angle) - this.y * Math.sin(angle),
                y = this.x * Math.sin(angle) + this.y * Math.cos(angle);
            this.x = x;
            this.y = y;
            return this;
        },
        rotateDegree = function (angle) {
            return this.rotateRadian(angle * Math.PI / 180);
        },
        clone = function () {
            return module(this.x, this.y);
        },
        toMatrix = function () {
            var matrix = Matrix(1, 3);
            matrix.set(0, 0, this.x);
            matrix.set(0, 1, this.y);
            matrix.set(0, 2, 1);
            return matrix;
        },
        module = function (x, y) {
            return {
                x: x,
                y: y,
                isVector2: isVector2,
                add: add,
                addTo: addTo,
                substract: substract,
                substractFrom: substractFrom,
                angle: angle,
                angleBetween: angleBetween,
                dotProduct: dotProduct,
                multiply: multiply,
                multiplyWith: multiplyWith,
                divide: divide,
                divideBy: divideBy,
                scalarMultiply: scalarMultiply,
                scalarMultiplyWith: scalarMultiplyWith,
                scale: scale,
                length: length,
                normalize: normalize,
                distance: distance,
                rotateRadian: rotateRadian,
                rotateDegree: rotateDegree,
                clone: clone,
                toMatrix: toMatrix
            };
        };
    return module;
});
/**
 * A helper module that returns a rectangle as the best fit of a multiplication of the screen size.
 * Assuming portrait mode, autoresize first tries to fit the width and then fills up the height
 * <br>Exports: Function
 * @module bento/autoresize
 * @param {Rectangle} canvasDimension - Default size
 * @param {Number} minSize - Minimal width/height
 * @param {Number} maxSize - Maximum width/height
 * @param {Boolean} isLandscape - Landscape or portrait
 * @returns Rectangle
 */
 bento.define('bento/autoresize', [
    'bento/utils'
], function (Utils) {
    return function (canvasDimension, minSize, maxSize, isLandscape) {
        var originalDimension = canvasDimension.clone(),
            innerWidth = window.innerWidth,
            innerHeight = window.innerHeight,
            deviceHeight = isLandscape ? innerWidth : innerHeight,
            deviceWidth = isLandscape ? innerHeight : innerWidth,
            swap = function () {
                // swap width and height
                temp = canvasDimension.width;
                canvasDimension.width = canvasDimension.height;
                canvasDimension.height = temp;
            },
            setup = function () {
                var i = 2,
                    height = canvasDimension.height,
                    screenHeight,
                    windowRatio = deviceHeight / deviceWidth,
                    canvasRatio = canvasDimension.height / canvasDimension.width;

                if (windowRatio < 1) {
                    canvasRatio = windowRatio;
                    screenHeight = deviceHeight;
                } else {
                    // user is holding device wrong
                    canvasRatio = deviceWidth / deviceHeight;
                    screenHeight = deviceWidth;
                }

                height = screenHeight;
                // real screenheight is not reported correctly
                screenHeight *= window.devicePixelRatio || 1;
                console.log(screenHeight);
                
                // dynamic height
                while (height > maxSize) {
                    height = Math.floor(screenHeight / i);
                    i += 1;
                    // too small: give up
                    if (height < minSize) {
                        height = isLandscape ? originalDimension.height : originalDimension.width;
                        break;
                    }
                }

                canvasDimension.width = height / canvasRatio;
                canvasDimension.height = height;
                if (!isLandscape) {
                    swap();
                }
                return canvasDimension;
            },
            scrollAndResize = function () {
                window.scrollTo(0, 0);
            };
        window.addEventListener('orientationchange', scrollAndResize, false);
        if (!isLandscape) {
            swap();
        }
        return setup();
    };
});
/**
 * Screen object. Screens are convenience modules that are similar to levels/rooms/scenes in games.
 * Tiled Map Editor can be used to design the levels.  
 * <br>Exports: Function
 * @module bento/screen
 * @param {Object} settings - Settings object
 * @param {String} settings.tiled - Asset name of the json file
 * @param {String} settings.onShow - Callback when screen starts
 * @param {Rectangle} [settings.dimension] - Set dimension of the screen (overwritten by tmx size)
 * @returns Screen
 */
bento.define('bento/screen', [
    'bento/utils',
    'bento',
    'bento/math/rectangle',
    'bento/tiled'
], function (Utils, Bento, Rectangle, Tiled) {
    'use strict';
    return function (settings) {
        /*settings = {
            dimension: Rectangle, [optional / overwritten by tmx size]
            tiled: String
        }*/
        var viewport = Bento.getViewport(),
            dimension = (settings && settings.dimension) ? settings.dimension : viewport.clone(),
            tiled,
            module = {
                /**
                 * Name of the screen
                 * @instance
                 * @name name
                 */
                name: null,
                /**
                 * Sets dimension of the screen
                 * @function
                 * @instance
                 * @param {Rectangle} rectangle - Dimension
                 * @name setDimension
                 */
                setDimension: function (rectangle) {
                    dimension.width = rectangle.width;
                    dimension.height = rectangle.height;
                },
                /**
                 * Gets dimension of the screen
                 * @function
                 * @instance
                 * @returns {Rectangle} rectangle - Dimension
                 * @name getDimension
                 */
                getDimension: function () {
                    return dimension;
                },
                extend: function (object) {
                    return Utils.extend(this, object);
                },
                /**
                 * Loads a tiled map
                 * @function
                 * @instance
                 * @returns {String} name - Name of the JSON asset
                 * @name loadTiled
                 */
                loadTiled: function (name) {
                    tiled = Tiled({
                        name: name,
                        spawn: true // TEMP
                    });
                    this.setDimension(tiled.dimension);
                },
                /**
                 * Callback when the screen is shown (called by screen manager)
                 * @function
                 * @instance
                 * @returns {Object} data - Extra data to be passed
                 * @name onShow
                 */
                onShow: function (data) {
                    if (settings) {
                        // load tiled map if present
                        if (settings.tiled) {
                            this.loadTiled(settings.tiled);
                        }
                        // callback
                        if (settings.onShow) {
                            settings.onShow(data);
                        }
                    }
                },
                /**
                 * Removes all objects and restores viewport position
                 * @function
                 * @instance
                 * @returns {Object} data - Extra data to be passed
                 * @name onHide
                 */
                onHide: function (data) {
                    // remove all objects
                    Bento.removeAll();
                    // reset viewport scroll when hiding screen
                    viewport.x = 0;
                    viewport.y = 0;
                    // callback
                    if (settings.onHide) {
                        settings.onHide(data);
                    }
                }
            };

        return module;
    };
});
/**
 * Reads Tiled JSON file and spawns entities accordingly.
 * Backgrounds are merged into a canvas image (TODO: split canvas, split layers?)
 * <br>Exports: Function
 * @module bento/screen
 * @param {Object} settings - Settings object
 * @param {String} settings.name - Asset name of the json file
 * @param {Boolean} [settings.spawn] - Spawns entities
 * @returns Object
 */
define('bento/tiled', [
    'bento',
    'bento/entity',
    'bento/math/vector2',
    'bento/math/rectangle',
    'bento/math/polygon',
    'bento/packedimage',
    'bento/utils'
], function (Bento, Entity, Vector2, Rectangle, Polygon, PackedImage, Utils) {
    'use strict';
    return function (settings, onReady) {
        /*settings = {
            name: String, // name of JSON file
            background: Boolean // TODO false: splits tileLayer tile entities,
            spawn: Boolean // adds objects into game immediately
        }*/
        var json = Bento.assets.getJson(settings.name),
            i,
            j,
            k,
            width = json.width,
            height = json.height,
            layers = json.layers.length,
            tileWidth = json.tilewidth,
            tileHeight = json.tileheight,
            canvas = document.createElement('canvas'),
            context = canvas.getContext('2d'),
            image,
            layer,
            firstgid,
            object,
            points,
            objects = [],
            shapes = [],
            viewport = Bento.getViewport(),
            background = Entity().extend({
                z: 0,
                draw: function (gameData) {
                    var w = Math.max(Math.min(canvas.width - viewport.x, viewport.width), 0),
                        h = Math.max(Math.min(canvas.height - viewport.y, viewport.height), 0),
                        img = PackedImage(canvas);

                    if (w === 0 || h === 0) {
                        return;
                    }
                    // only draw the part in the viewport
                    gameData.renderer.drawImage(
                        img, ~~ (Math.max(Math.min(viewport.x, canvas.width), 0)), ~~ (Math.max(Math.min(viewport.y, canvas.height), 0)), ~~w, ~~h,
                        0,
                        0, ~~w, ~~h
                    );
                }
            }),
            getTileset = function (gid) {
                var l,
                    tileset,
                    current = null;
                // loop through tilesets and find the highest firstgid that's
                // still lower or equal to the gid
                for (l = 0; l < json.tilesets.length; ++l) {
                    tileset = json.tilesets[l];
                    if (tileset.firstgid <= gid) {
                        current = tileset;
                    }
                }
                return current;
            },
            getTile = function (tileset, gid) {
                var index,
                    tilesetWidth,
                    tilesetHeight;
                if (tileset === null) {
                    return null;
                }
                index = gid - tileset.firstgid;
                tilesetWidth = Math.floor(tileset.imagewidth / tileset.tilewidth);
                tilesetHeight = Math.floor(tileset.imageheight / tileset.tileheight);
                return {
                    // convention: the tileset name must be equal to the asset name!
                    subimage: Bento.assets.getImage(tileset.name),
                    x: (index % tilesetWidth) * tileset.tilewidth,
                    y: Math.floor(index / tilesetWidth) * tileset.tileheight,
                    width: tileset.tilewidth,
                    height: tileset.tileheight
                };
            },
            drawTileLayer = function (x, y) {
                var gid = layer.data[y * width + x],
                    // get correct tileset and image
                    tileset = getTileset(gid),
                    tile = getTile(tileset, gid);
                // draw background to offscreen canvas
                if (tile) {
                    context.drawImage(
                        tile.subimage.image,
                        tile.subimage.x + tile.x,
                        tile.subimage.y + tile.y,
                        tile.width,
                        tile.height,
                        x * tileWidth,
                        y * tileHeight,
                        tileWidth,
                        tileHeight
                    );
                }
            },
            spawn = function (name, obj, tilesetProperties) {
                var x = obj.x,
                    y = obj.y,
                    params = {};

                // collect parameters
                Utils.extend(params, tilesetProperties);
                Utils.extend(params, obj.properties);

                require([name], function (Instance) {
                    var instance = Instance.apply(this, [params]),
                        origin = instance.getOrigin(),
                        dimension = instance.getDimension(),
                        prop,
                        addProperties = function (properties) {
                            var prop;
                            for (prop in properties) {
                                if (prop === 'module' || prop.match(/param\d+/)) {
                                    continue;
                                }
                                if (properties.hasOwnProperty(prop)) {
                                    // number or string?
                                    if (isNaN(properties[prop])) {
                                        instance[prop] = properties[prop];
                                    } else {
                                        instance[prop] = (+properties[prop]);
                                    }
                                }
                            }
                        };

                    instance.setPosition({
                        // tiled assumes origin (0, 1)
                        x: x + (origin.x),
                        y: y + (origin.y - dimension.height)
                    });

                    // add in tileset properties
                    //addProperties(tilesetProperties);
                    // add tile properties
                    //addProperties(obj.properties);

                    // add to game
                    if (settings.spawn) {
                        Bento.objects.add(instance);
                    }
                    objects.push(instance);
                });
            },
            spawnObject = function (obj) {
                var gid = obj.gid,
                    // get tileset: should contain module name
                    tileset = getTileset(gid),
                    id = gid - tileset.firstgid,
                    properties,
                    moduleName;
                if (tileset.tileproperties) {
                    properties = tileset.tileproperties[id.toString()];
                    if (properties) {
                        moduleName = properties.module;
                    }
                }
                if (moduleName) {
                    spawn(moduleName, obj, properties);
                }
            },
            spawnShape = function (shape, type) {
                var obj;
                if (settings.spawn) {
                    obj = Entity({
                        z: 0,
                        name: type,
                        family: [type],
                        useHshg: true,
                        staticHshg: true
                    }).extend({
                        update: function () {},
                        draw: function () {}
                    });
                    obj.setBoundingBox(shape);
                    Bento.objects.add(obj);
                }
                shape.type = type;
                shapes.push(shape);
            };

        // setup canvas
        // to do: split up in multiple canvas elements due to max
        // size
        canvas.width = width * tileWidth;
        canvas.height = height * tileHeight;

        // loop through layers
        for (k = 0; k < layers; ++k) {
            layer = json.layers[k];
            if (layer.type === 'tilelayer') {
                // loop through tiles
                for (j = 0; j < layer.height; ++j) {
                    for (i = 0; i < layer.width; ++i) {
                        drawTileLayer(i, j);
                    }
                }
            } else if (layer.type === 'objectgroup') {
                for (i = 0; i < layer.objects.length; ++i) {
                    object = layer.objects[i];

                    // default type is solid
                    if (object.type === '') {
                        object.type = 'solid';
                    }

                    if (object.gid) {
                        // normal object
                        spawnObject(object);
                    } else if (object.polygon) {
                        // polygon 
                        points = [];
                        for (j = 0; j < object.polygon.length; ++j) {
                            points.push({
                                x: object.polygon[j].x + object.x,
                                y: object.polygon[j].y + object.y + 1
                            });
                            // shift polygons 1 pixel down?
                            // something might be wrong with polygon definition
                        }
                        spawnShape(Polygon(points), object.type);
                    } else {
                        // rectangle
                        spawnShape(Rectangle(object.x, object.y, object.width, object.height), object.type);
                    }
                }
            }
        }

        // add background to game
        if (settings.spawn) {
            Bento.objects.add(background);
        }

        return {
            /**
             * All tilelayers merged into one entity
             * @instance
             * @name tileLayer
             */
            tileLayer: background,
            /**
             * Array of entities
             * @instance
             * @name objects
             */
            objects: objects,
            /**
             * Array of Rectangles and Polygons
             * @instance
             * @name shapes
             */
            shapes: shapes,
            /**
             * Size of the screen
             * @instance
             * @name dimension
             */
            dimension: Rectangle(0, 0, tileWidth * width, tileHeight * height)
        };
    };
});
/**
 * The Tween is an entity that performs an interpolation within a timeframe. The entity
 * removes itself after the tween ends.
 * Default tweens: linear, quadratic, squareroot, cubic, cuberoot, exponential, elastic, sin, cos
 * <br>Exports: Function
 * @module bento/tween
 * @param {Object} settings - Settings object
 * @param {Number} settings.from - Starting value
 * @param {Number} settings.to - End value
 * @param {Number} settings.in - Time frame
 * @param {String} settings.ease - Choose between default tweens or see http://easings.net/
 * @param {Number} [settings.alpha] - For use in exponential y=exp(αt) or elastic y=exp(αt)*cos(βt)
 * @param {Number} [settings.beta] - For use in elastic y=exp(αt)*cos(βt)
 * @param {Boolean} [settings.stay] - Don't remove the entity automatically
 * @param {Function} [settings.do] - Called every tick during the tween lifetime. Callback parameters: (value, time)
 * @param {Function} [settings.onComplete] - Called when tween ends
 * @param {Number} [settings.id] - Adds an id property to the tween. Useful when spawning tweens in a loop,
 * @param {Boolean} [settings.updateWhenPaused] - Continue tweening even when the game is paused (optional) 
 * @returns Entity
 */
bento.define('bento/tween', [
    'bento',
    'bento/utils',
    'bento/entity'
], function (Bento, Utils, Entity) {
    'use strict';
    var robbertPenner = {
            // t: current time, b: begInnIng value, c: change In value, d: duration
            easeInQuad: function (t, b, c, d) {
                return c * (t /= d) * t + b;
            },
            easeOutQuad: function (t, b, c, d) {
                return -c * (t /= d) * (t - 2) + b;
            },
            easeInOutQuad: function (t, b, c, d) {
                if ((t /= d / 2) < 1) return c / 2 * t * t + b;
                return -c / 2 * ((--t) * (t - 2) - 1) + b;
            },
            easeInCubic: function (t, b, c, d) {
                return c * (t /= d) * t * t + b;
            },
            easeOutCubic: function (t, b, c, d) {
                return c * ((t = t / d - 1) * t * t + 1) + b;
            },
            easeInOutCubic: function (t, b, c, d) {
                if ((t /= d / 2) < 1) return c / 2 * t * t * t + b;
                return c / 2 * ((t -= 2) * t * t + 2) + b;
            },
            easeInQuart: function (t, b, c, d) {
                return c * (t /= d) * t * t * t + b;
            },
            easeOutQuart: function (t, b, c, d) {
                return -c * ((t = t / d - 1) * t * t * t - 1) + b;
            },
            easeInOutQuart: function (t, b, c, d) {
                if ((t /= d / 2) < 1) return c / 2 * t * t * t * t + b;
                return -c / 2 * ((t -= 2) * t * t * t - 2) + b;
            },
            easeInQuint: function (t, b, c, d) {
                return c * (t /= d) * t * t * t * t + b;
            },
            easeOutQuint: function (t, b, c, d) {
                return c * ((t = t / d - 1) * t * t * t * t + 1) + b;
            },
            easeInOutQuint: function (t, b, c, d) {
                if ((t /= d / 2) < 1) return c / 2 * t * t * t * t * t + b;
                return c / 2 * ((t -= 2) * t * t * t * t + 2) + b;
            },
            easeInSine: function (t, b, c, d) {
                return -c * Math.cos(t / d * (Math.PI / 2)) + c + b;
            },
            easeOutSine: function (t, b, c, d) {
                return c * Math.sin(t / d * (Math.PI / 2)) + b;
            },
            easeInOutSine: function (t, b, c, d) {
                return -c / 2 * (Math.cos(Math.PI * t / d) - 1) + b;
            },
            easeInExpo: function (t, b, c, d) {
                return (t === 0) ? b : c * Math.pow(2, 10 * (t / d - 1)) + b;
            },
            easeOutExpo: function (t, b, c, d) {
                return (t === d) ? b + c : c * (-Math.pow(2, -10 * t / d) + 1) + b;
            },
            easeInOutExpo: function (t, b, c, d) {
                if (t === 0) return b;
                if (t === d) return b + c;
                if ((t /= d / 2) < 1) return c / 2 * Math.pow(2, 10 * (t - 1)) + b;
                return c / 2 * (-Math.pow(2, -10 * --t) + 2) + b;
            },
            easeInCirc: function (t, b, c, d) {
                return -c * (Math.sqrt(1 - (t /= d) * t) - 1) + b;
            },
            easeOutCirc: function (t, b, c, d) {
                return c * Math.sqrt(1 - (t = t / d - 1) * t) + b;
            },
            easeInOutCirc: function (t, b, c, d) {
                if ((t /= d / 2) < 1) return -c / 2 * (Math.sqrt(1 - t * t) - 1) + b;
                return c / 2 * (Math.sqrt(1 - (t -= 2) * t) + 1) + b;
            },
            easeInElastic: function (t, b, c, d) {
                var s = 1.70158,
                    p = 0,
                    a = c;
                if (t === 0) return b;
                if ((t /= d) === 1) return b + c;
                if (!p) p = d * 0.3;
                if (a < Math.abs(c)) {
                    a = c;
                    s = p / 4;
                } else s = p / (2 * Math.PI) * Math.asin(c / a);
                return -(a * Math.pow(2, 10 * (t -= 1)) * Math.sin((t * d - s) * (2 * Math.PI) / p)) + b;
            },
            easeOutElastic: function (t, b, c, d) {
                var s = 1.70158,
                    p = 0,
                    a = c;
                if (t === 0) return b;
                if ((t /= d) === 1) return b + c;
                if (!p) p = d * 0.3;
                if (a < Math.abs(c)) {
                    a = c;
                    s = p / 4;
                } else s = p / (2 * Math.PI) * Math.asin(c / a);
                return a * Math.pow(2, -10 * t) * Math.sin((t * d - s) * (2 * Math.PI) / p) + c + b;
            },
            easeInOutElastic: function (t, b, c, d) {
                var s = 1.70158,
                    p = 0,
                    a = c;
                if (t === 0) return b;
                if ((t /= d / 2) === 2) return b + c;
                if (!p) p = d * (0.3 * 1.5);
                if (a < Math.abs(c)) {
                    a = c;
                    s = p / 4;
                } else s = p / (2 * Math.PI) * Math.asin(c / a);
                if (t < 1) return -0.5 * (a * Math.pow(2, 10 * (t -= 1)) * Math.sin((t * d - s) * (2 * Math.PI) / p)) + b;
                return a * Math.pow(2, -10 * (t -= 1)) * Math.sin((t * d - s) * (2 * Math.PI) / p) * 0.5 + c + b;
            },
            easeInBack: function (t, b, c, d, s) {
                if (s === undefined) s = 1.70158;
                return c * (t /= d) * t * ((s + 1) * t - s) + b;
            },
            easeOutBack: function (t, b, c, d, s) {
                if (s === undefined) s = 1.70158;
                return c * ((t = t / d - 1) * t * ((s + 1) * t + s) + 1) + b;
            },
            easeInOutBack: function (t, b, c, d, s) {
                if (s === undefined) s = 1.70158;
                if ((t /= d / 2) < 1) return c / 2 * (t * t * (((s *= (1.525)) + 1) * t - s)) + b;
                return c / 2 * ((t -= 2) * t * (((s *= (1.525)) + 1) * t + s) + 2) + b;
            },
            easeInBounce: function (t, b, c, d) {
                return c - this.easeOutBounce(d - t, 0, c, d) + b;
            },
            easeOutBounce: function (t, b, c, d) {
                if ((t /= d) < (1 / 2.75)) {
                    return c * (7.5625 * t * t) + b;
                } else if (t < (2 / 2.75)) {
                    return c * (7.5625 * (t -= (1.5 / 2.75)) * t + 0.75) + b;
                } else if (t < (2.5 / 2.75)) {
                    return c * (7.5625 * (t -= (2.25 / 2.75)) * t + 0.9375) + b;
                } else {
                    return c * (7.5625 * (t -= (2.625 / 2.75)) * t + 0.984375) + b;
                }
            },
            easeInOutBounce: function (t, b, c, d) {
                if (t < d / 2) return this.easeInBounce(t * 2, 0, c, d) * 0.5 + b;
                return this.easeOutBounce(t * 2 - d, 0, c, d) * 0.5 + c * 0.5 + b;
            }
        },
        interpolations = {
            linear: function (s, e, t, alpha, beta) {
                return (e - s) * t + s;
            },
            quadratic: function (s, e, t, alpha, beta) {
                return (e - s) * t * t + s;
            },
            squareroot: function (s, e, t, alpha, beta) {
                return (e - s) * Math.pow(t, 0.5) + s;
            },
            cubic: function (s, e, t, alpha, beta) {
                return (e - s) * t * t * t + s;
            },
            cuberoot: function (s, e, t, alpha, beta) {
                return (e - s) * Math.pow(t, 1 / 3) + s;
            },
            exponential: function (s, e, t, alpha, beta) {
                //takes alpha as growth/damp factor
                return (e - s) / (Math.exp(alpha) - 1) * Math.exp(alpha * t) + s - (e - s) / (Math.exp(alpha) - 1);
            },
            elastic: function (s, e, t, alpha, beta) {
                //alpha=growth factor, beta=wavenumber
                return (e - s) / (Math.exp(alpha) - 1) * Math.cos(beta * t * 2 * Math.PI) * Math.exp(alpha * t) + s - (e - s) / (Math.exp(alpha) - 1);
            },
            sin: function (s, e, t, alpha, beta) {
                //s=offset, e=amplitude, alpha=wavenumber
                return s + e * Math.sin(alpha * t * 2 * Math.PI);
            },
            cos: function (s, e, t, alpha, beta) {
                //s=offset, e=amplitude, alpha=wavenumber
                return s + e * Math.cos(alpha * t * 2 * Math.PI);
            }
        },
        interpolate = function (type, s, e, t, alpha, beta) {
            // interpolate(string type,float from,float to,float time,float alpha,float beta)
            // s = starting value
            // e = ending value
            // t = time variable (going from 0 to 1)
            var fn = interpolations[type];
            if (fn) {
                return fn(s, e, t, alpha, beta);
            } else {
                return robbertPenner[type](t, s, e - s, 1);
            }
        };
    return function (settings) {
        /* settings = {
            from: Number
            to: Number
            in: Number
            ease: String
            alpha: Number (optional)
            beta: Number (optional)
            stay: Boolean (optional)
            do: Gunction (value, time) {} (optional)
            onComplete: function () {} (optional)
            id: Number (optional),
            updateWhenPaused: Boolean (optional)
        }*/
        var time = 0,
            added = false,
            running = true,
            tween = Entity(settings).extend({
                id: settings.id,
                update: function (data) {
                    if (!running) {
                        return;
                    }
                    ++time;
                    // run update
                    if (settings.do) {
                        settings.do.apply(this, [interpolate(
                            settings.ease || 'linear',
                            settings.from || 0,
                            Utils.isDefined(settings.to) ? settings.to : 1,
                            time / (settings.in),
                            Utils.isDefined(settings.alpha) ? settings.alpha : 1,
                            Utils.isDefined(settings.beta) ? settings.beta : 1
                        ), time]);
                    }
                    // end
                    if (!settings.stay && time >= settings.in) {
                        if (settings.onComplete) {
                            settings.onComplete.apply(this);
                        }
                        Bento.objects.remove(tween);
                        added = false;
                    }
                },
                begin: function () {
                    time = 0;
                    if (!added) {
                        Bento.objects.add(tween);
                        added = true;
                    }
                    running = true;
                    return tween;
                },
                stop: function () {
                    time = 0;
                    running = false;
                    return tween;
                }
            });
        if (settings.in === 0) {
            settings.in = 1;
        }
        // tween automatically starts ?
        tween.begin();
        return tween;
    };
});
/**
 * Canvas 2d renderer
 * @copyright (C) 2015 LuckyKat
 */
bento.define('bento/renderers/canvas2d', [
    'bento/utils'
], function (Utils) {
    return function (canvas, settings) {
        var context = canvas.getContext('2d'),
            original = context,
            renderer = {
                name: 'canvas2d',
                save: function () {
                    context.save();
                },
                restore: function () {
                    context.restore();
                },
                translate: function (x, y) {
                    context.translate(x, y);
                },
                scale: function (x, y) {
                    context.scale(x, y);
                },
                rotate: function (angle) {
                    context.rotate(angle);
                },
                fillRect: function (colorArray, x, y, w, h) {
                    var colorStr = getColor(colorArray),
                        oldOpacity = context.globalAlpha;
                    if (colorArray[3] !== 1) {
                        context.globalAlpha = colorArray[3];
                    }
                    context.fillStyle = colorStr;
                    context.fillRect(x, y, w, h);
                    if (colorArray[3] !== 1) {
                        context.globalAlpha = oldOpacity;
                    }
                },
                fillCircle: function (colorArray, x, y, radius) {
                    var colorStr = getColor(colorArray),
                        oldOpacity = context.globalAlpha;
                    if (colorArray[3] !== 1) {
                        context.globalAlpha = colorArray[3];
                    }
                    context.fillStyle = colorStr;
                    context.beginPath();
                    context.arc(x, y, radius, 0, Math.PI * 2);
                    context.fill();
                    context.closePath();

                },
                strokeRect: function (colorArray, x, y, w, h) {
                    var colorStr = getColor(colorArray),
                        oldOpacity = context.globalAlpha;
                    if (colorArray[3] !== 1) {
                        context.globalAlpha = colorArray[3];
                    }
                    context.strokeStyle = colorStr;
                    context.strokeRect(x, y, w, h);
                    if (colorArray[3] !== 1) {
                        context.globalAlpha = oldOpacity;
                    }
                },
                drawImage: function (packedImage, sx, sy, sw, sh, x, y, w, h) {
                    context.drawImage(packedImage.image, packedImage.x + sx, packedImage.y + sy, sw, sh, x, y, w, h);
                },
                getOpacity: function () {
                    return context.globalAlpha;
                },
                setOpacity: function (value) {
                    context.globalAlpha = value;
                },
                createSurface: function (width, height) {
                    var newCanvas = document.createElement('canvas'),
                        newContext;

                    newCanvas.width = width;
                    newCanvas.height = height;

                    newContext = canvas.getContext('2d');

                    return newContext;
                },
                setContext: function (ctx) {
                    context = ctx;
                },
                restoreContext: function () {
                    context = original;
                }
            },
            getColor = function (colorArray) {
                var colorStr = '#';
                colorStr += ('00' + Math.floor(colorArray[0] * 255).toString(16)).slice(-2);
                colorStr += ('00' + Math.floor(colorArray[1] * 255).toString(16)).slice(-2);
                colorStr += ('00' + Math.floor(colorArray[2] * 255).toString(16)).slice(-2);
                return colorStr;
            };
        console.log('Init canvas2d as renderer');

        if (!settings.smoothing) {
            if (context.imageSmoothingEnabled) {
                context.imageSmoothingEnabled = false;
            }
            if (context.webkitImageSmoothingEnabled) {
                context.webkitImageSmoothingEnabled = false;
            }
            if (context.mozImageSmoothingEnabled) {
                context.mozImageSmoothingEnabled = false;
            }
        }
        return renderer;
    };
});
bento.define('bento/renderers/pixi', [
    'bento/utils'
], function (Utils) {
    return function (canvas, settings) {
        var context,
            pixiStage,
            pixiRenderer,
            pixiBatch,
            currentObject,
            renderer = {
                name: 'pixi',
                init: function () {

                },
                destroy: function () {},
                save: function (obj) {},
                restore: function () {},
                translate: function (x, y) {},
                scale: function (x, y) {},
                rotate: function (angle) {},
                fillRect: function (color, x, y, w, h) {},
                fillCircle: function (color, x, y, radius) {},
                drawImage: function (image, sx, sy, sw, sh, x, y, w, h) {},
                flush: function () {
                    pixiRenderer.render(pixiStage);
                },
                addChild: function (child) {
                    pixiStage.addChild(child);
                },
                removeChild: function (child) {
                    pixiStage.removeChild(sprite);
                }
            };
        if (!window.PIXI) {
            throw 'Pixi library missing';
        }

        // init pixi
        pixiStage = new PIXI.Container();
        pixiRenderer = PIXI.autoDetectRenderer(canvas.width, canvas.height, {
            view: canvas,
            backgroundColor: 0x000000
        });
        console.log('Init pixi as renderer');
        console.log(pixiRenderer.view === canvas);

        return renderer;
    };
});
/**
 * WebGL renderer using gl-sprites by Matt DesLauriers
 * @copyright (C) 2015 LuckyKat
 */
bento.define('bento/renderers/webgl', [
    'bento/utils',
    'bento/renderers/canvas2d'
], function (Utils, Canvas2d) {
    return function (canvas, settings) {
        var canWebGl = (function () {
                // try making a canvas
                try {
                    var canvas = document.createElement('canvas');
                    return !!window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
                } catch (e) {
                    return false;
                }
            })(),
            context,
            glRenderer,
            original,
            renderer = {
                name: 'webgl',
                save: function () {
                    glRenderer.save();
                },
                restore: function () {
                    glRenderer.restore();
                },
                translate: function (x, y) {
                    glRenderer.translate(x, y);
                },
                scale: function (x, y) {
                    glRenderer.scale(x, y);
                },
                rotate: function (angle) {
                    glRenderer.rotate(angle);
                },
                fillRect: function (color, x, y, w, h) {
                    var oldColor = glRenderer.color;
                    // 
                    renderer.setColor(color);
                    glRenderer.fillRect(x, y, w, h);
                    glRenderer.color = oldColor;
                },
                fillCircle: function (color, x, y, radius) {},
                strokeRect: function (color, x, y, w, h) {
                    var oldColor = glRenderer.color;
                    // 
                    renderer.setColor(color);
                    glRenderer.strokeRect(x, y, w, h);
                    glRenderer.color = oldColor;
                },
                drawImage: function (packedImage, sx, sy, sw, sh, x, y, w, h) {
                    var image = packedImage.image;
                    if (!image.texture) {
                        image.texture = window.GlSprites.createTexture2D(context, image);
                    }
                    glRenderer.drawImage(image.texture, packedImage.x + sx, packedImage.y + sy, sw, sh, x, y, sw, sh);
                },
                begin: function () {
                    glRenderer.begin();
                },
                flush: function () {
                    glRenderer.end();
                },
                setColor: function (color) {
                    glRenderer.color = color;
                },
                getOpacity: function () {
                    return glRenderer.color[3];
                },
                setOpacity: function (value) {
                    glRenderer.color[3] = value;
                },
                createSurface: function (width, height) {
                    var newCanvas = document.createElement('canvas'),
                        newContext,
                        newGlRenderer;

                    newCanvas.width = width;
                    newCanvas.height = height;

                    newContext = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
                    newGlRenderer = window.GlSprites.SpriteRenderer(newContext);
                    newGlRenderer.ortho(canvas.width, canvas.height);

                    return newGlRenderer;
                },
                setContext: function (ctx) {
                    glRenderer = ctx;
                },
                restoreContext: function () {
                    glRenderer = original;
                }
            };
        console.log('Init webgl as renderer');

        // fallback
        if (canWebGl && Utils.isDefined(window.GlSprites)) {
            context = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');

            glRenderer = window.GlSprites.SpriteRenderer(context);
            glRenderer.ortho(canvas.width, canvas.height);
            original = glRenderer;
            return renderer;
        } else {
            console.log('webgl failed, revert to canvas');
            return Canvas2d(canvas, settings);
        }
    };
});
bento.define('bento/gui/clickbutton', [
    'bento',
    'bento/math/vector2',
    'bento/math/rectangle',
    'bento/components/sprite',
    'bento/components/clickable',
    'bento/entity',
    'bento/utils',
    'bento/tween',
    'bento/eventsystem'
], function (
    Bento,
    Vector2,
    Rectangle,
    Sprite,
    Clickable,
    Entity,
    Utils,
    Tween,
    EventSystem
) {
    'use strict';
    return function (settings) {
        var viewport = Bento.getViewport(),
            active = true,
            entitySettings = Utils.extend({
                z: 0,
                name: '',
                originRelative: Vector2(0.5, 0.5),
                position: Vector2(0, 0),
                components: [Sprite, Clickable],
                family: ['buttons'],
                sprite: {
                    image: settings.image,
                    frameWidth: settings.frameWidth || 32,
                    frameHeight: settings.frameHeight || 32,
                    animations: settings.animations || {
                        'up': {
                            speed: 0,
                            frames: [0]
                        },
                        'down': {
                            speed: 0,
                            frames: [1]
                        }
                    }
                },
                clickable: {
                    onClick: function () {
                        entity.sprite.setAnimation('down');
                    },
                    onHoldEnter: function () {
                        entity.sprite.setAnimation('down');
                    },
                    onHoldLeave: function () {
                        entity.sprite.setAnimation('up');
                    },
                    pointerUp: function () {
                        entity.sprite.setAnimation('up');
                    },
                    onHoldEnd: function () {
                        if (active && settings.onClick) {
                            settings.onClick.apply(entity);
                            if (settings.sfx) {
                                Bento.audio.stopSound(settings.sfx);
                                Bento.audio.playSound(settings.sfx);
                            }
                            EventSystem.fire('clickButton', entity);
                        }
                    }
                },
                init: function () {
                    this.sprite.setAnimation('up');
                }
            }, settings),
            entity = Entity(entitySettings).extend({
                setActive: function (bool) {
                    active = bool;
                },
                doCallback: function () {
                    settings.onClick.apply(entity);
                }
            });

        if (Utils.isDefined(settings.active)) {
            active = settings.active;
        }

        return entity;
    };
});
bento.define('bento/gui/counter', [
    'bento',
    'bento/entity',
    'bento/math/vector2',
    'bento/components/sprite',
    'bento/components/translation',
    'bento/components/rotation',
    'bento/components/scale',
    'bento/utils'
], function (
    Bento,
    Entity,
    Vector2,
    Sprite,
    Translation,
    Rotation,
    Scale,
    Utils
) {
    'use strict';
    return function (settings) {
        /*{
            value: Number,
            spacing: Vector,
            align: String,
            frameWidth: Number,
            frameHeight: Number,
            image: Image,
            position: Vector
        }*/
        var value = settings.value || 0,
            spacing = settings.spacing || Vector2(0, 0),
            alignment = settings.align || settings.alignment || 'right',
            digitWidth = 0,
            children = [],
            /*
             * Counts the number of digits in the value
             */
            getDigits = function () {
                return Math.floor(value).toString().length;
            },
            /*
             * Returns an entity with all digits as animation
             */
            createDigit = function () {
                return Entity({
                    components: [Sprite],
                    sprite: {
                        image: settings.image,
                        frameWidth: settings.frameWidth,
                        frameHeight: settings.frameHeight,
                        animations: {
                            '0': {
                                frames: [0]
                            },
                            '1': {
                                frames: [1]
                            },
                            '2': {
                                frames: [2]
                            },
                            '3': {
                                frames: [3]
                            },
                            '4': {
                                frames: [4]
                            },
                            '5': {
                                frames: [5]
                            },
                            '6': {
                                frames: [6]
                            },
                            '7': {
                                frames: [7]
                            },
                            '8': {
                                frames: [8]
                            },
                            '9': {
                                frames: [9]
                            }
                        }
                    },
                    init: function () {
                        // setup all digits
                        digitWidth = settings.frameWidth;
                    }
                });
            },
            /*
             * Adds or removes children depending on the value
             * and number of current digits and updates
             * the visualuzation of the digits
             */
            updateDigits = function () {
                // add or remove digits
                var i,
                    valueStr = value.toString(),
                    pos,
                    digit,
                    digits = getDigits(),
                    difference = children.length - digits;
                /* update number of children to be
                    the same as number of digits*/
                if (difference < 0) {
                    // create new
                    for (i = 0; i < Math.abs(difference); ++i) {
                        digit = createDigit();
                        children.push(digit);
                        base.attach(digit);

                    }
                } else if (difference > 0) {
                    // remove
                    for (i = 0; i < Math.abs(difference); ++i) {
                        digit = children.pop();
                        base.remove(digit);
                    }
                }
                /* update animations */
                for (i = 0; i < children.length; ++i) {
                    digit = children[i];
                    digit.setPosition(Vector2((digitWidth + spacing.x) * i, 0));
                    digit.sprite.setAnimation(valueStr.substr(i, 1));
                }

                /* alignment */
                if (alignment === 'right') {
                    // move all the children
                    for (i = 0; i < children.length; ++i) {
                        digit = children[i];
                        pos = digit.getPosition().clone();
                        pos.substract(Vector2((digitWidth + spacing.x) * digits - spacing.x, 0));
                        digit.setPosition(pos);
                    }
                } else if (alignment === 'center') {
                    for (i = 0; i < children.length; ++i) {
                        digit = children[i];
                        pos = digit.getPosition();
                        pos.addTo(Vector2(((digitWidth + spacing.x) * digits - spacing.x) / -2, 0));
                    }
                }
            },
            entitySettings = {
                z: settings.z,
                name: settings.name,
                position: settings.position,
                components: [Translation, Rotation, Scale]
            },
            base;

        Utils.extend(entitySettings, settings);

        /*
         * Public interface
         */
        base = Entity(entitySettings).extend({
            init: function () {
                updateDigits();
            },
            /*
             * Sets current value
             */
            setValue: function (val) {
                value = val;
                updateDigits();
            },
            /*
             * Retrieves current value
             */
            getValue: function () {
                return value;
            },
            addValue: function (val) {
                value += val;
                updateDigits();
            },
            getDigits: function () {
                return getDigits();
            }
        });
        return base;
    };
});
bento.define('bento/gui/togglebutton', [
    'bento',
    'bento/math/vector2',
    'bento/math/rectangle',
    'bento/components/sprite',
    'bento/components/clickable',
    'bento/entity',
    'bento/utils',
    'bento/tween'
], function (
    Bento,
    Vector2,
    Rectangle,
    Sprite,
    Clickable,
    Entity,
    Utils,
    Tween
) {
    'use strict';
    return function (settings) {
        var viewport = Bento.getViewport(),
            active = true,
            toggled = false,
            entitySettings = Utils.extend({
                z: 0,
                name: '',
                originRelative: Vector2(0.5, 0.5),
                position: Vector2(0, 0),
                components: [Sprite, Clickable],
                family: ['buttons'],
                sprite: {
                    image: settings.image,
                    frameWidth: settings.frameWidth || 32,
                    frameHeight: settings.frameHeight || 32,
                    animations: settings.animations || {
                        'up': {
                            speed: 0,
                            frames: [0]
                        },
                        'down': {
                            speed: 0,
                            frames: [1]
                        }
                    }
                },
                clickable: {
                    onClick: function () {
                        entity.sprite.setAnimation('down');
                    },
                    onHoldEnter: function () {
                        entity.sprite.setAnimation('down');
                    },
                    onHoldLeave: function () {
                        entity.sprite.setAnimation(toggled ? 'down' : 'up');
                    },
                    pointerUp: function () {
                        entity.sprite.setAnimation(toggled ? 'down' : 'up');
                    },
                    onHoldEnd: function () {
                        if (!active) {
                            return;
                        }
                        if (toggled) {
                            toggled = false;
                        } else {
                            toggled = true;
                        }
                        if (settings.onToggle) {
                            settings.onToggle.apply(entity);
                            if (settings.sfx) {
                                Bento.audio.stopSound(settings.sfx);
                                Bento.audio.playSound(settings.sfx);
                            }
                        }
                        entity.sprite.setAnimation(toggled ? 'down' : 'up');
                    }
                },
                init: function () {}
            }, settings),
            entity = Entity(entitySettings).extend({
                isToggled: function () {
                    return toggled;
                },
                toggle: function (state, doCallback) {
                    if (Utils.isDefined(state)) {
                        toggled = state;
                    } else {
                        toggled = !toggled;
                    }
                    if (doCallback) {
                        if (settings.onToggle) {
                            settings.onToggle.apply(entity);
                            if (settings.sfx) {
                                Bento.audio.stopSound(settings.sfx);
                                Bento.audio.playSound(settings.sfx);
                            }
                        }
                    }
                    entity.sprite.setAnimation(toggled ? 'down' : 'up');
                }
            });

        if (Utils.isDefined(settings.active)) {
            active = settings.active;
        }
        // set intial state
        if (settings.toggled) {
            toggled = true;
        }
        entity.sprite.setAnimation(toggled ? 'down' : 'up');
        return entity;
    };
});